import { randomUUID, createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, open } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { fixture, origin } from './fixtures';
import { createFeedbackStore } from './store';
import { startSharedService } from './shared-service';
import { ensureSharedService, stopSharedService } from './service-discovery';
import { serviceRequest } from './service-client';
import { diagnoseService, repairService } from './diagnostics';
import { backupService, restoreService } from './backup';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { runCli } from './cli-commands';
import { probeOwner } from './service-owner';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const run of cleanup.splice(0).reverse()) await run();
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), 'ainotation-recovery-'));
  cleanup.push(() => rm(path, { recursive: true, force: true }));
  return path;
}

it('recovers a deleted live data directory without starting a competing service', async () => {
  const root = await temporary();
  const directory = join(root, 'service');
  const app = join(root, 'app');
  await mkdir(app);
  await writeFile(join(app, 'package.json'), '{}');
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  const project = (await serviceRequest(service.connection, '/control/projects', {
    method: 'POST',
    body: { directory: app, declaration: { name: randomUUID() } },
  })) as { projectId: string };
  const grant = (await serviceRequest(service.connection, '/control/grants', {
    method: 'POST',
    body: { projectId: project.projectId, kind: 'browser', origin },
  })) as { token: string };
  const document = fixture();
  const response = await fetch(`${service.connection.url}/sessions/${document.id}/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${grant.token}`,
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ document, operations: [] }),
  });
  expect(response.status).toBe(200);
  await response.body?.cancel();
  await rm(directory, { recursive: true });
  const connections = await Promise.all(
    Array.from({ length: 8 }, () => ensureSharedService({ directory })),
  );
  expect(
    connections.every((connection) => connection.instanceId === service.connection.instanceId),
  ).toBe(true);
  await expect(startSharedService({ directory })).rejects.toThrow('coordinator');
  const feedback = JSON.parse(
    await readFile(join(directory, 'projects', project.projectId, 'feedback.json'), 'utf8'),
  );
  expect(feedback.sessions[0].document).toEqual(document);
  expect(
    JSON.parse(await readFile(join(directory, 'projects.json'), 'utf8')).projects,
  ).toHaveLength(1);
  expect((await diagnoseService(directory)).issues).toEqual([]);
});

it('never removes discovery files replaced by another instance during shutdown', async () => {
  const directory = await temporary();
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  const replacement = { ...service.connection, instanceId: randomUUID() };
  await writeFile(join(directory, 'connection.json'), JSON.stringify(replacement));
  await writeFile(
    join(directory, 'service.lock'),
    JSON.stringify({ instanceId: replacement.instanceId, pid: replacement.pid }),
  );
  await service.close();
  expect(JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8'))).toEqual(
    replacement,
  );
  expect(JSON.parse(await readFile(join(directory, 'service.lock'), 'utf8')).instanceId).toBe(
    replacement.instanceId,
  );
});

it('releases the OS coordinator even if filesystem cleanup fails', async () => {
  const directory = await temporary();
  const service = await startSharedService({ directory });
  cleanup.push(() => service.close().catch(() => {}));
  await rm(join(directory, 'service.lock'));
  await mkdir(join(directory, 'service.lock'));
  await expect(service.close()).rejects.toThrow();
  expect(await probeOwner(directory)).toBeUndefined();
});

it('refuses to signal a PID that does not match the coordinator owner', async () => {
  const directory = await temporary();
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  await writeFile(
    join(directory, 'connection.json'),
    JSON.stringify({ ...service.connection, pid: 2147483647 }),
  );
  const kill = vi.spyOn(process, 'kill');
  await expect(stopSharedService(directory)).rejects.toThrow('conflicting coordinator ownership');
  expect(kill).not.toHaveBeenCalled();
});

it('repairs a crashed service coordinator without signaling another process', async () => {
  const directory = await temporary();
  const module = pathToFileURL(join(import.meta.dirname, '../dist/shared-service.mjs')).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `const {startSharedService}=await import(${JSON.stringify(module)}); await startSharedService({directory:process.argv[1]}); process.stdout.write('ready');`,
      directory,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  cleanup.push(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exit = once(child, 'exit');
      child.kill('SIGKILL');
      await exit;
    }
  });
  await once(child.stdout!, 'data', { signal: AbortSignal.timeout(10000) });
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  expect(
    (await diagnoseService(directory)).issues.some((issue) => issue.code === 'stale-owner'),
  ).toBe(true);
  await repairService(directory);
  const service = await startSharedService({ directory });
  cleanup.push(service.close);
  expect((await ensureSharedService({ directory })).instanceId).toBe(service.connection.instanceId);
});

it('writes an unchanged in-memory snapshot back after deletion and preserves corruption', async () => {
  const root = await temporary();
  const filePath = join(root, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  await rm(filePath);
  await store.sync(document.id, { document, operations: [] }, origin);
  expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(document);
  await writeFile(filePath, '{broken');
  await store.repair();
  expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(document);
  const preserved = (await readdir(root)).find((name) => name.includes('.corrupt-'))!;
  expect(await readFile(join(root, preserved), 'utf8')).toBe('{broken');
});

it('restores backups with a new epoch and pauses stale browser snapshots until an explicit choice', async () => {
  const root = await temporary();
  const filePath = join(root, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.updateAnnotation(document.id, document.annotations[0]!.id, {
    comment: 'Latest edit',
  });
  const local = store.get(document.id);
  await writeFile(filePath, '{broken');
  const restored = await createFeedbackStore({ filePath });
  expect(restored.storageEpoch).not.toBe(store.storageEpoch);
  const conflict = await restored.sync(
    document.id,
    { document: local, operations: [], storageEpoch: store.storageEpoch },
    origin,
  );
  expect(conflict.recovery).toBeDefined();
  expect(restored.get(document.id)).toEqual(document);
  await restored.updateAnnotation(document.id, document.annotations[0]!.id, {
    comment: 'Another agent changed it',
  });
  await expect(
    restored.sync(
      document.id,
      {
        document: local,
        operations: [],
        storageEpoch: store.storageEpoch,
        recovery: {
          epoch: restored.storageEpoch,
          revision: conflict.recovery!.revision,
          source: 'browser',
        },
      },
      origin,
    ),
  ).rejects.toMatchObject({ code: 'recovery-stale' });
  const refreshed = await restored.sync(
    document.id,
    { document: local, operations: [], storageEpoch: store.storageEpoch },
    origin,
  );
  const result = await restored.sync(
    document.id,
    {
      document: local,
      operations: [],
      storageEpoch: store.storageEpoch,
      recovery: {
        epoch: restored.storageEpoch,
        revision: refreshed.recovery!.revision,
        source: 'browser',
      },
    },
    origin,
  );
  expect(result.document).toEqual(local);
  expect(result.recovery).toBeUndefined();
  expect((await readdir(`${filePath}.recovery`)).length).toBeGreaterThanOrEqual(2);
});

it('does not acknowledge or publish mutations when persistence fails', async () => {
  const root = await temporary();
  const filePath = join(root, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  const before = await readFile(filePath, 'utf8');
  const handle = await open(join(root, 'probe'), 'w');
  const prototype = Object.getPrototypeOf(handle) as typeof handle;
  await handle.close();
  const write = vi
    .spyOn(prototype, 'writeFile')
    .mockRejectedValue(Object.assign(new Error('Full'), { code: 'ENOSPC' }));
  await expect(
    store.updateAnnotation(document.id, document.annotations[0]!.id, { comment: 'Not persisted' }),
  ).rejects.toMatchObject({ code: 'ENOSPC' });
  expect(store.get(document.id)).toEqual(document);
  expect(await readFile(filePath, 'utf8')).toBe(before);
  write.mockRestore();
  await store.updateAnnotation(document.id, document.annotations[0]!.id, {
    comment: 'Persisted now',
  });
  expect((await createFeedbackStore({ filePath })).get(document.id).annotations[0]!.comment).toBe(
    'Persisted now',
  );
});

it('detects deleted image files, notifies connected clients and requests a replacement', async () => {
  const directory = await temporary();
  const filePath = join(directory, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
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
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.putImage(document.id, image.id, png, origin);
  await store.repair();
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  await rm(join(`${filePath}.images`, document.id, `${image.id}.png`));
  await store.repair();
  expect(changed).toHaveBeenCalledOnce();
  const response = await store.sync(
    document.id,
    { document, operations: [], storageEpoch: store.storageEpoch },
    origin,
  );
  expect(response.missingImages).toEqual([image.id]);
  await store.putImage(document.id, image.id, png, origin);
  expect(await store.getImage(document.id, image.id)).toEqual(png);
});

it('diagnoses without changing files, repairs explicitly, and restores a retained external backup', async () => {
  const root = await temporary();
  const directory = join(root, 'service');
  await mkdir(directory);
  await writeFile(join(directory, 'projects.json'), '{broken-registry');
  const before = await readdir(directory);
  const report = await diagnoseService(directory);
  const output: string[] = [];
  await runCli(['doctor', '--data-dir', directory, '--json'], {
    directory: root,
    output: (text) => output.push(text),
  });
  expect(JSON.parse(output.join('')).issues).toEqual(report.issues);
  expect(report.issues.some((issue) => issue.code === 'registry-damaged')).toBe(true);
  expect(await readdir(directory)).toEqual(before);
  await expect(repairService(directory)).rejects.toThrow('damaged');
  expect(await readFile(join(directory, 'projects.json'), 'utf8')).toBe('{broken-registry');
  await repairService(directory, true);
  const path = join(directory, 'projects', randomUUID(), 'feedback.json');
  const store = await createFeedbackStore({ filePath: path });
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  const destination = join(root, 'backups');
  await backupService(directory, destination, 1);
  const backup = await backupService(directory, destination, 1);
  expect(await readdir(destination)).toHaveLength(1);
  await rm(directory, { recursive: true });
  await restoreService(directory, backup.snapshot);
  const restored = await createFeedbackStore({ filePath: path });
  expect(restored.get(document.id)).toEqual(document);
  expect(restored.storageEpoch).not.toBe(store.storageEpoch);
  expect(JSON.stringify(await diagnoseService(directory))).not.toContain(
    document.annotations[0]!.comment,
  );
});
