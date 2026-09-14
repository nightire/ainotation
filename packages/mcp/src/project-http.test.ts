import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vite-plus/test';
import { initializeProject } from './project';
import { startSharedService, readServiceConnection } from './shared-service';
import { type IssuedGrant } from './project-service';
import { fixture, origin } from './fixtures';
import { createFeedbackStore } from './store';

const cleanup: (() => Promise<unknown>)[] = [];

it('stores PNG bytes separately, verifies content, and authorizes image access by project and session', async () => {
  const { root, request, json, first, second, grant } = await setup();
  const browser = await grant(first.projectId, 'browser');
  const agent = await grant(first.projectId, 'agent');
  const foreign = await grant(second.projectId, 'agent');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const document = fixture();
  const image = {
    id: randomUUID(),
    mimeType: 'image/png' as const,
    source: 'import' as const,
    width: 1,
    height: 1,
    size: png.length,
    sha256: createHash('sha256').update(png).digest('hex'),
  };
  document.annotations[0]!.images = [image];
  const sync = json({ document, operations: [] });
  expect(
    (
      await request(`/sessions/${document.id}/sync`, browser.token, {
        ...sync,
        headers: { ...sync.headers, Origin: origin },
      })
    ).status,
  ).toBe(200);
  const path = `/sessions/${document.id}/images/${image.id}`;
  expect((await request(path, agent.token)).status).toBe(404);
  const upload = {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'image/png' },
    body: png,
  };
  expect(
    (await request(path, browser.token, { ...upload, body: Buffer.from('not an image') })).status,
  ).toBe(400);
  expect((await request(path, browser.token, upload)).status).toBe(200);
  expect((await request(path, browser.token, upload)).status).toBe(200);
  expect((await request(path, foreign.token)).status).toBe(404);
  expect((await request(`/sessions/${randomUUID()}/images/${image.id}`, agent.token)).status).toBe(
    404,
  );
  expect(
    (
      await request(path, agent.token, {
        method: 'POST',
        headers: { 'Content-Type': 'image/png' },
        body: png,
      })
    ).status,
  ).toBe(405);
  const response = await request(path, agent.token);
  expect(response.headers.get('content-type')).toBe('image/png');
  expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
  const reopened = await createFeedbackStore({
    filePath: join(root, 'service', 'projects', first.projectId, 'feedback.json'),
  });
  expect(await reopened.getImage(document.id, image.id)).toEqual(png);
  const replacement = structuredClone(document.annotations[0]!);
  replacement.images![0]!.sha256 = 'f'.repeat(64);
  const replaceRequest = json({
    document,
    operations: [{ id: randomUUID(), kind: 'upsert', annotation: replacement }],
  });
  expect(
    (
      await request(`/sessions/${document.id}/sync`, browser.token, {
        ...replaceRequest,
        headers: { ...replaceRequest.headers, Origin: origin },
      })
    ).status,
  ).toBe(409);
  expect(Buffer.from(await (await request(path, agent.token)).arrayBuffer())).toEqual(png);
  expect(
    (
      await request(
        `/sessions/${document.id}/annotations/${document.annotations[0]!.id}`,
        agent.token,
        { method: 'DELETE' },
      )
    ).status,
  ).toBe(200);
  expect((await request(path, agent.token)).status).toBe(404);
});
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-project-http-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const a = join(root, 'a');
  const b = join(root, 'b');
  await Promise.all([mkdir(a), mkdir(b)]);
  for (const directory of [a, b]) {
    await writeFile(join(directory, 'package.json'), '{}');
    await initializeProject({ directory });
  }
  const service = await startSharedService({ directory: join(root, 'service') });
  cleanup.push(service.close);
  const { url, token } = service.connection;
  const request = (path: string, bearer = token, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${bearer}`);
    return fetch(`${url}${path}`, { ...options, headers });
  };
  const json = (value: unknown) => ({
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  const first = (await (
    await request('/control/projects', token, json({ directory: a }))
  ).json()) as { projectId: string };
  const second = (await (
    await request('/control/projects', token, json({ directory: b }))
  ).json()) as { projectId: string };
  const grant = async (projectId: string, kind: 'browser' | 'agent'): Promise<IssuedGrant> => {
    const response = await request(
      '/control/grants',
      token,
      json({ projectId, kind, ...(kind === 'browser' ? { origin } : {}) }),
    );
    expect(response.status).toBe(201);
    return (await response.json()) as IssuedGrant;
  };
  return { root, service, request, json, first, second, grant };
}

it('keeps browser sync and agent CRUD within their project even when foreign IDs are known', async () => {
  const { request, json, first, second, grant } = await setup();
  const browserA = await grant(first.projectId, 'browser');
  const browserB = await grant(second.projectId, 'browser');
  const agentA = await grant(first.projectId, 'agent');
  const agentB = await grant(second.projectId, 'agent');
  const documentA = fixture();
  const documentB = fixture();
  documentB.annotations[0]!.comment = 'B feedback';
  const sync = async (token: string, document: ReturnType<typeof fixture>) => {
    const options = json({ document, operations: [] });
    return request(`/sessions/${document.id}/sync`, token, {
      ...options,
      headers: { ...options.headers, Origin: origin },
    });
  };
  expect((await sync(browserA.token, documentA)).status).toBe(200);
  expect((await sync(browserB.token, documentB)).status).toBe(200);
  const spoofed = fixture();
  const spoofRequest = json({ document: spoofed, operations: [], projectId: second.projectId });
  expect(
    (
      await request(`/sessions/${spoofed.id}/sync`, browserA.token, {
        ...spoofRequest,
        headers: { ...spoofRequest.headers, Origin: origin },
      })
    ).status,
  ).toBe(200);
  const listA = (await (await request('/sessions', agentA.token)).json()) as {
    sessions: { id: string }[];
  };
  expect(listA.sessions.map((session) => session.id)).toEqual([documentA.id, spoofed.id]);
  expect((await request(`/sessions/${spoofed.id}`, agentB.token)).status).toBe(404);
  const foreign = `/sessions/${documentB.id}/annotations/${documentB.annotations[0]!.id}`;
  for (const options of [
    {},
    { method: 'DELETE' },
    { ...json({ comment: 'Cross-project edit' }), method: 'PATCH' },
  ]) {
    expect((await request(foreign, agentA.token, options)).status).toBe(404);
  }
  const content = {
    id: crypto.randomUUID(),
    comment: 'Agent-created A feedback',
    page: documentA.annotations[0]!.page,
    targets: documentA.annotations[0]!.targets,
  };
  expect(
    (await request(`/sessions/${documentA.id}/annotations`, agentA.token, json(content))).status,
  ).toBe(200);
  expect(
    (await request(`/sessions/${documentB.id}/annotations`, agentA.token, json(content))).status,
  ).toBe(404);
  const own = `/sessions/${documentA.id}/annotations/${content.id}`;
  expect(
    (await request(own, agentA.token, { ...json({ comment: 'Updated A' }), method: 'PATCH' }))
      .status,
  ).toBe(200);
  expect(await (await request(own, agentA.token)).json()).toMatchObject({ comment: 'Updated A' });
  expect((await request(own, agentA.token, { method: 'DELETE' })).status).toBe(200);
  const b = await (await request(`/sessions/${documentB.id}`, agentB.token)).json();
  expect(JSON.stringify(b)).toContain('B feedback');
  expect(JSON.stringify(b)).not.toContain('Updated A');
  expect((await request('/sessions', browserA.token, { headers: { Origin: origin } })).status).toBe(
    403,
  );
  expect((await sync(agentA.token, documentA)).status).toBe(403);
});

it('requires control authorization, exact Host/Origin and bounded JSON with no credential reflection', async () => {
  const { request, json, first, grant, service } = await setup();
  const browser = await grant(first.projectId, 'browser');
  expect((await request('/control/projects', browser.token)).status).toBe(401);
  expect(
    (
      await request('/control/grants', service.connection.token, {
        ...json({ kind: 'agent', projectId: first.projectId }),
        headers: { 'Content-Type': 'application/json', Origin: origin },
      })
    ).status,
  ).toBe(403);
  expect(
    (await request('/health', browser.token, { headers: { Origin: `${origin}/` } })).status,
  ).toBe(403);
  const badHost = await new Promise<number>((resolve, reject) => {
    const req = httpRequest(
      `${service.connection.url}/health`,
      {
        headers: { Origin: origin, Host: 'evil.example', Authorization: `Bearer ${browser.token}` },
      },
      (response) => {
        response.resume();
        response.once('end', () => resolve(response.statusCode!));
        response.once('error', reject);
      },
    );
    req.once('error', reject);
    req.end();
  });
  expect(badHost).toBe(403);
  expect(
    (
      await request(`/health?token=${browser.token}`, browser.token, {
        headers: { Origin: origin },
      })
    ).status,
  ).toBe(404);
  const preflight = await request('/health', '', {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type',
    },
  });
  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('access-control-allow-origin')).toBe(origin);
  expect(
    (await request('/control/projects', service.connection.token, { method: 'POST', body: '{}' }))
      .status,
  ).toBe(415);
  const tooLarge = await request(
    '/control/projects',
    service.connection.token,
    json({ directory: 'x'.repeat(1024 * 1024) }),
  );
  expect(tooLarge.status).toBe(413);
  const forged = await request('/health', 'PRIVATE_FORGED_TOKEN', { headers: { Origin: origin } });
  expect(forged.status).toBe(401);
  expect(await forged.text()).not.toContain('PRIVATE_FORGED_TOKEN');
  const spoof = await request(
    '/control/grants',
    service.connection.token,
    json({ kind: 'agent', projectId: first.projectId, origin }),
  );
  expect(spoof.status).toBe(400);
});

it('rejects inconsistent annotation URLs and closes an event stream when its grant is revoked', async () => {
  const { request, json, first, second, grant, service } = await setup();
  const browser = await grant(first.projectId, 'browser');
  const other = await grant(second.projectId, 'browser');
  const document = fixture();
  const invalid = structuredClone(document);
  invalid.annotations[0]!.page.url = `${origin}/different`;
  const sync = async (document: ReturnType<typeof fixture>) => {
    const options = json({ document, operations: [] });
    return request(`/sessions/${document.id}/sync`, browser.token, {
      ...options,
      headers: { ...options.headers, Origin: origin },
    });
  };
  expect((await sync(invalid)).status).toBe(400);
  expect((await sync(document)).status).toBe(200);
  expect(
    (await request(`/sessions/${document.id}/events`, other.token, { headers: { Origin: origin } }))
      .status,
  ).toBe(404);
  const stream = await request(`/sessions/${document.id}/events`, browser.token, {
    headers: { Origin: origin },
    signal: AbortSignal.timeout(3000),
  });
  expect(stream.status).toBe(200);
  const reader = stream.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: changed');
  const renewed = await request(
    `/control/grants/${browser.grantId}/renew`,
    service.connection.token,
    { method: 'POST' },
  );
  expect(renewed.status).toBe(200);
  expect(
    (
      await request(`/control/grants/${browser.grantId}`, service.connection.token, {
        method: 'DELETE',
      })
    ).status,
  ).toBe(204);
  expect((await reader.read()).done).toBe(true);
  expect((await request('/health', browser.token, { headers: { Origin: origin } })).status).toBe(
    401,
  );
});

it('uses a single owner per data directory and rotates connection credentials on restart', async () => {
  const { service, first, request, json, grant } = await setup();
  const connection = await readServiceConnection(service.directory);
  expect(connection).toEqual(service.connection);
  if (process.platform !== 'win32')
    expect((await stat(join(service.directory, 'connection.json'))).mode & 0o777).toBe(0o600);
  await expect(startSharedService({ directory: service.directory })).rejects.toThrow(
    'already locked',
  );
  expect(await readServiceConnection(service.directory)).toEqual(connection);
  const browser = await grant(first.projectId, 'browser');
  const document = fixture();
  const input = json({ document, operations: [] });
  expect(
    (
      await request(`/sessions/${document.id}/sync`, browser.token, {
        ...input,
        headers: { ...input.headers, Origin: origin },
      })
    ).status,
  ).toBe(200);
  await service.close();
  expect(await readServiceConnection(service.directory)).toBeUndefined();
  const restarted = await startSharedService({ directory: service.directory });
  cleanup.push(restarted.close);
  expect(restarted.connection.instanceId).not.toBe(connection!.instanceId);
  expect(restarted.connection.token).not.toBe(connection!.token);
  const issued = await fetch(`${restarted.connection.url}/control/grants`, {
    ...json({ projectId: first.projectId, kind: 'agent' }),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${restarted.connection.token}`,
    },
  });
  const agent = (await issued.json()) as IssuedGrant;
  const sessions = await fetch(`${restarted.connection.url}/sessions`, {
    headers: { Authorization: `Bearer ${agent.token}` },
  });
  expect(await sessions.json()).toMatchObject({ sessions: [{ id: document.id }] });
  expect(
    (
      await fetch(`${restarted.connection.url}/project`, {
        headers: { Authorization: `Bearer ${browser.token}`, Origin: origin },
      })
    ).status,
  ).toBe(403);
  expect(await readFile(join(service.directory, 'projects.json'), 'utf8')).not.toContain(
    browser.token,
  );
});
