import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createFeedbackDocument } from '@ainotation/schema';
import type { ProjectInfo } from '@ainotation/mcp/project';
import { createDevelopmentBridge } from './bridge';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup(upstream: Response, healthMethod?: 'GET' | 'POST') {
  const connection = {
    connect: vi.fn(async () => {}),
    fetch: vi.fn(async () => upstream),
    close: vi.fn(async () => {}),
  };
  let origin = '';
  const bridge = createDevelopmentBridge({
    project: {
      root: '/test-project',
      config: { version: 1, projectId: crypto.randomUUID(), name: 'test-project' },
      toolchain: { kind: 'vite', configFiles: [] },
    } satisfies ProjectInfo,
    path: '/__ainotation',
    originFor: () => origin,
    createConnection: () => connection,
  });
  cleanup.push(() => bridge.close());
  const server = createServer((request, response) => {
    void bridge.handle(request, response, request.url!.slice('/__ainotation'.length));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test address');
  origin = `http://127.0.0.1:${address.port}`;
  const bootstrap = await fetch(`${origin}/__ainotation/connect`, {
    method: 'POST',
    headers: { Origin: origin, 'X-Ainotation-Client': '1' },
  });
  const { endpoint, token } = (await bootstrap.json()) as { endpoint: string; token: string };
  if (healthMethod)
    return fetch(`${endpoint}/health`, {
      method: healthMethod,
      headers: { Origin: origin, Authorization: `Bearer ${token}` },
    });
  const document = createFeedbackDocument(`${origin}/`);
  return fetch(`${endpoint}/sessions/${document.id}/sync`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ document, operations: [] }),
  });
}

it('proxies a read-only capability probe through the authenticated development connection', async () => {
  const health = { ok: true, capabilities: { styleSuggestions: true, sharedStyles: true } };
  const response = await setup(Response.json(health), 'GET');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(health);
  expect((await setup(Response.json(health), 'POST')).status).toBe(404);
});

it.each([
  'recovery-stale',
  'storage-conflict',
  'storage-unavailable',
  'storage-damaged',
  'service-ownership',
])('preserves the %s code required by browser sync recovery', async (code) => {
  const response = await setup(
    Response.json({ code, error: 'Private upstream details', token: 'private' }, { status: 409 }),
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    code,
    error: 'Project sync failed. Check the development server connection.',
  });
});

it.each(['null', '<html>Unavailable</html>', '{"code":"unknown","error":"private"}'])(
  'keeps a generic error when the upstream diagnostic is invalid: %s',
  async (body) => {
    const response = await setup(new Response(body, { status: 503 }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: 'Project sync failed. Check the development server connection.',
    });
  },
);
