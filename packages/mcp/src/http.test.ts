import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { SyncResponseSchema } from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createFeedbackStore, startHttpServer } from './index';
import { fixture, origin, testToken } from './fixtures';

const servers: Awaited<ReturnType<typeof startHttpServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  vi.useRealTimers();
});
async function setup() {
  const store = await createFeedbackStore();
  const server = await startHttpServer({
    store,
    token: testToken,
    origins: [origin, 'http://localhost:5173'],
    port: 0,
  });
  servers.push(server);
  const document = fixture();
  const headers = {
    Origin: origin,
    Authorization: `Bearer ${testToken}`,
    'Content-Type': 'application/json',
  };
  const sync = (input: unknown = { document, operations: [] }) =>
    fetch(`${server.url}/sessions/${document.id}/sync`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    });
  return { store, server, document, headers, sync };
}

function raw(
  url: string,
  headers: Record<string, string>,
  chunks: string[] = [],
  method = 'GET',
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(url, { headers, method }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
      response.on('error', reject);
    });
    request.on('error', reject);
    for (const chunk of chunks) request.write(chunk);
    request.end();
  });
}

it('requires exact Origin, Host and bearer auth on health and all actual routes', async () => {
  const { server, document, headers } = await setup();
  expect((await raw(`${server.url}/health`, headers)).status).toBe(200);
  expect(
    (
      await raw(`${server.url}/health`, {
        ...headers,
        Host: `localhost:${new URL(server.url).port}`,
      })
    ).status,
  ).toBe(200);
  for (const path of [
    '/health',
    `/sessions/${document.id}/sync`,
    `/sessions/${document.id}/events`,
    '/unknown',
  ]) {
    for (const authorization of ['', 'Bearer wrong-test-token', `Basic ${testToken}`]) {
      expect(
        (await raw(`${server.url}${path}`, { ...headers, Authorization: authorization })).status,
      ).toBe(401);
    }
    for (const badOrigin of ['', 'null', 'https://evil.example', `${origin}.evil.example`]) {
      expect((await raw(`${server.url}${path}`, { ...headers, Origin: badOrigin })).status).toBe(
        403,
      );
    }
    for (const host of ['evil.example', '127.0.0.1:1', '[::1]:4748', 'localhost']) {
      expect((await raw(`${server.url}${path}`, { ...headers, Host: host })).status).toBe(403);
    }
  }
  const { Authorization: _authorization, ...withoutAuth } = headers;
  const { Origin: _origin, ...withoutOrigin } = headers;
  expect((await raw(`${server.url}/health`, withoutAuth)).status).toBe(401);
  expect((await raw(`${server.url}/health`, withoutOrigin)).status).toBe(403);
  expect((await raw(`${server.url}/health?token=${testToken}`, withoutAuth)).status).toBe(401);
});

it('allows browser preflight only for exact origins, methods and headers', async () => {
  const { server } = await setup();
  const headers = {
    Origin: origin,
    'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'authorization, content-type',
  };
  const response = await fetch(`${server.url}/health`, { method: 'OPTIONS', headers });
  expect(response.status).toBe(204);
  expect(response.headers.get('access-control-allow-origin')).toBe(origin);
  expect(response.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type');
  for (const changes of [
    { Origin: 'null' },
    { 'Access-Control-Request-Method': 'DELETE' },
    { 'Access-Control-Request-Headers': 'x-user-id' },
  ]) {
    expect(
      (
        await fetch(`${server.url}/health`, {
          method: 'OPTIONS',
          headers: { ...headers, ...changes },
        })
      ).status,
    ).toBe(403);
  }
});

it('validates JSON, UUIDs, operation roles, bounds and body size including chunked requests', async () => {
  const { server, document, headers, sync, store } = await setup();
  const url = `${server.url}/sessions/${document.id}/sync`;
  expect(
    (await raw(url, { ...headers, 'Content-Type': 'text/plain' }, ['{}'], 'POST')).status,
  ).toBe(415);
  expect((await raw(url, headers, ['{'], 'POST')).status).toBe(400);
  expect((await raw(url, headers, ['x'.repeat(1024 * 1024), 'x'.repeat(100)], 'POST')).status).toBe(
    413,
  );
  expect(
    (await fetch(url, { method: 'POST', headers, body: 'x'.repeat(1024 * 1024 + 1) })).status,
  ).toBe(413);
  expect(
    (await fetch(`${server.url}/sessions/not-a-uuid/sync`, { method: 'POST', headers, body: '{}' }))
      .status,
  ).toBe(400);
  expect(
    (
      await sync({
        document,
        operations: [
          {
            id: randomUUID(),
            kind: 'reply',
            annotationId: document.annotations[0]!.id,
            reply: {
              id: randomUUID(),
              role: 'agent',
              message: 'Forged',
              createdAt: document.createdAt,
            },
          },
        ],
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await sync({
        document,
        operations: Array.from({ length: 1001 }, () => ({
          id: randomUUID(),
          kind: 'delete',
          annotationId: randomUUID(),
        })),
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await sync({
        document: { ...document, annotations: [document.annotations[0], document.annotations[0]] },
        operations: [],
      })
    ).status,
  ).toBe(400);
  expect(store.list()).toEqual([]);
});

it('returns authoritative snapshots and binds sessions permanently to URL and origin', async () => {
  const { server, document, headers, sync, store } = await setup();
  const response = await sync();
  expect(response.status).toBe(200);
  expect(SyncResponseSchema.parse(await response.json())).toEqual({ document, acknowledged: [] });
  await store.action(document.id, document.annotations[0]!.id, {
    kind: 'resolve',
    summary: 'Agent context',
  });
  const next = SyncResponseSchema.parse(await (await sync()).json());
  expect(next.document.annotations[0]).toMatchObject({
    status: 'resolved',
    replies: [{ role: 'agent', message: 'Agent context' }],
  });
  expect(
    (await sync({ document: { ...document, url: 'https://evil.example' }, operations: [] })).status,
  ).toBe(403);
  expect(
    (await sync({ document: { ...document, url: `${origin}/other` }, operations: [] })).status,
  ).toBe(409);
  expect(
    (
      await fetch(`${server.url}/sessions/${document.id}/events`, {
        headers: { ...headers, Origin: 'http://localhost:5173' },
      })
    ).status,
  ).toBe(404);
  expect((await fetch(`${server.url}/sessions/${randomUUID()}/events`, { headers })).status).toBe(
    404,
  );
});

it('streams initial and changed events, heartbeats, and closes subscriptions on disconnect/shutdown', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const { server, document, headers, sync, store } = await setup();
  await sync();
  const unsubscribe = vi.fn();
  const originalSubscribe = store.subscribe.bind(store);
  vi.spyOn(store, 'subscribe').mockImplementation((id, listener) => {
    const remove = originalSubscribe(id, listener);
    return () => {
      unsubscribe();
      remove();
    };
  });
  const controller = new AbortController();
  const response = await fetch(`${server.url}/sessions/${document.id}/events`, {
    headers,
    signal: controller.signal,
  });
  expect(response.headers.get('content-type')).toBe('text/event-stream');
  const reader = response.body!.getReader();
  const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
  expect(decode((await reader.read()).value)).toBe(
    `event: changed\ndata: ${JSON.stringify({ sessionId: document.id })}\n\n`,
  );
  await store.action(document.id, document.annotations[0]!.id, { kind: 'acknowledge' });
  expect(decode((await reader.read()).value)).toContain('event: changed');
  await vi.advanceTimersByTimeAsync(15000);
  expect(decode((await reader.read()).value)).toBe(': heartbeat\n\n');
  controller.abort();
  await expect(reader.read()).rejects.toThrow();
  await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1));
  const second = await fetch(`${server.url}/sessions/${document.id}/events`, { headers });
  const secondReader = second.body!.getReader();
  await secondReader.read();
  await server.close();
  await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(2));
  expect((await secondReader.read()).done).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

it('fails on occupied ports and rejects wildcard configuration', async () => {
  const { server, store } = await setup();
  await expect(
    startHttpServer({
      store,
      token: testToken,
      origins: [origin],
      port: Number(new URL(server.url).port),
    }),
  ).rejects.toMatchObject({ code: 'EADDRINUSE' });
  await expect(
    startHttpServer({ store, token: testToken, origins: ['*'], port: 0 }),
  ).rejects.toThrow('exact HTTP(S)');
});
