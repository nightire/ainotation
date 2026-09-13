import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { startSharedService } from './shared-service';
import { ensureSharedService, stopSharedService } from './service-discovery';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'ainotation-discovery-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

it('authenticates and reuses a live service for simultaneous discovery calls', async () => {
  const directory = await temporary();
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  const connections = await Promise.all(
    Array.from({ length: 4 }, () => ensureSharedService({ directory })),
  );
  expect(connections).toEqual(Array.from({ length: 4 }, () => service.connection));
});

it('does not signal a service hosted in the calling process or an absent service', async () => {
  const directory = await temporary();
  expect(await stopSharedService(directory)).toBe(false);
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  await expect(stopSharedService(directory)).rejects.toThrow('calling process');
  expect(await ensureSharedService({ directory })).toEqual(service.connection);
});

it('rejects a mismatched service identity instead of trusting any listener at the recorded port', async () => {
  const directory = await temporary();
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  const path = join(directory, 'connection.json');
  await writeFile(path, JSON.stringify({ ...service.connection, instanceId: crypto.randomUUID() }));
  await expect(ensureSharedService({ directory })).rejects.toThrow(
    'Cannot verify the shared service',
  );
  expect(JSON.parse(await readFile(path, 'utf8')).instanceId).not.toBe(
    service.connection.instanceId,
  );
});

it('does not overwrite corrupt discovery metadata and honors cancellation before startup', async () => {
  const directory = await temporary();
  await writeFile(join(directory, 'connection.json'), 'invalid json');
  await expect(ensureSharedService({ directory })).rejects.toThrow(
    'Cannot read local service connection',
  );
  expect(await readFile(join(directory, 'connection.json'), 'utf8')).toBe('invalid json');
  const controller = new AbortController();
  controller.abort();
  await expect(ensureSharedService({ directory, signal: controller.signal })).rejects.toThrow();
});

it('reports a missing executable or a busy startup lock without spawning an unknown binary', async () => {
  const directory = await temporary();
  await expect(
    ensureSharedService({ directory, cliPath: join(directory, 'missing-cli.mjs') }),
  ).rejects.toThrow('Build or install');
  const locked = join(directory, 'locked');
  await mkdir(locked);
  await writeFile(
    join(locked, 'service.lock'),
    JSON.stringify({ pid: process.pid, instanceId: crypto.randomUUID() }),
  );
  await expect(
    ensureSharedService({
      directory: locked,
      startupTimeoutMs: 60,
      cliPath: join(directory, 'missing-cli.mjs'),
    }),
  ).rejects.toThrow('did not become ready');
});
