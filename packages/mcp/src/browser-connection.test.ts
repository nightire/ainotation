import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { initializeProject } from './project';
import { startSharedService } from './shared-service';
import { createBrowserConnection } from './browser-connection';
import { serviceRequest } from './service-client';
import type { ProjectGrant } from './project-service';
import { fixture, origin } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'ainotation-browser-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'app');
  await mkdir(root);
  await writeFile(join(root, 'package.json'), '{}');
  const project = await initializeProject({ directory: root });
  const service = await startSharedService({
    directory: join(directory, 'service'),
    leaseMs: 1200,
  });
  cleanup.push(service.close);
  const connection = createBrowserConnection({
    project,
    origin,
    serviceDirectory: service.directory,
  });
  cleanup.push(() => connection.close());
  const grants = async () =>
    ((await serviceRequest(service.connection, '/control/grants')) as { grants: ProjectGrant[] })
      .grants;
  return { connection, service, grants };
}

it('renews a dev-server lease, isolates proxy routes and revokes it on close', async () => {
  const { connection, grants } = await setup();
  await connection.connect();
  const initial = (await grants())[0]!;
  expect(initial.kind).toBe('browser');
  await vi.waitFor(
    async () => expect((await grants())[0]!.expiresAt).toBeGreaterThan(initial.expiresAt),
    { timeout: 2500 },
  );
  const document = fixture();
  const response = await connection.fetch(`/sessions/${document.id}/sync`, {
    method: 'POST',
    body: JSON.stringify({ document, operations: [] }),
    signal: new AbortController().signal,
  });
  expect(response.status).toBe(200);
  await response.body?.cancel();
  await expect(
    connection.fetch('/control/projects', { method: 'GET', signal: new AbortController().signal }),
  ).rejects.toThrow('Invalid browser proxy path');
  await connection.close();
  expect(await grants()).toEqual([]);
});

it('does not recreate a browser grant after explicit revocation', async () => {
  const { connection, service, grants } = await setup();
  await connection.connect();
  const initial = (await grants())[0]!;
  await serviceRequest(service.connection, `/control/grants/${initial.grantId}`, {
    method: 'DELETE',
  });
  const document = fixture();
  const response = await connection.fetch(`/sessions/${document.id}/sync`, {
    method: 'POST',
    body: JSON.stringify({ document, operations: [] }),
    signal: new AbortController().signal,
  });
  expect(response.status).toBe(403);
  await response.body?.cancel();
  await expect(connection.connect()).rejects.toThrow('revoked');
  expect(await grants()).toEqual([]);
});
