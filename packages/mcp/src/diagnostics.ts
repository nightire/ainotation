import { access, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  ServiceConnectionSchema,
  defaultServiceDirectory,
  type ServiceConnection,
} from './shared-service';
import {
  ownerPaths,
  probeOwner,
  acquireOwner,
  OwnerSchema,
  canonicalServiceDirectory,
} from './service-owner';
import { parseRegistry } from './project-service';
import { FeedbackStore, createFeedbackStore, parseFeedbackFile } from './store';
import { exists, readSnapshot, writeSnapshot } from './recovery-json';
import { serviceRequest } from './service-client';
import { ProjectError } from './project';

async function json(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8'));
}
export async function feedbackPaths(directory: string) {
  const parent = join(directory, 'projects');
  if (!(await exists(parent))) return [];
  const entries = await readdir(parent, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && z.uuid().safeParse(entry.name).success)
    .map((entry) => join(parent, entry.name, 'feedback.json'));
}
function processExists(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}
async function liveConnection(directory: string): Promise<ServiceConnection | undefined> {
  const owner = await probeOwner(directory);
  for (const path of [join(directory, 'connection.json'), ownerPaths(directory).record]) {
    try {
      const connection = ServiceConnectionSchema.parse(await json(path));
      if (owner && (owner.instanceId !== connection.instanceId || owner.pid !== connection.pid))
        continue;
      const health = (await serviceRequest(connection, '/control/health', { timeoutMs: 1000 })) as {
        instanceId?: string;
      };
      if (health.instanceId === connection.instanceId) return connection;
    } catch {
      /* Report unavailable metadata without printing credentials or file contents. */
    }
  }
  return undefined;
}

export async function diagnoseService(directory = defaultServiceDirectory()) {
  directory = await canonicalServiceDirectory(directory);
  const issues: { code: string; file: string; message: string }[] = [];
  const add = (code: string, file: string, message: string) => issues.push({ code, file, message });
  const live = await liveConnection(directory);
  const owner = await probeOwner(directory);
  if (live) {
    const health = (await serviceRequest(live, '/control/health')) as {
      maintenanceHealthy?: boolean;
      capabilities?: { recovery?: boolean };
    };
    if (!health.capabilities?.recovery)
      add(
        'service-upgrade-required',
        directory,
        'Restart the shared service with the upgraded package to enable recovery.',
      );
    if (health.maintenanceHealthy === false)
      add(
        'maintenance-failed',
        directory,
        'The running service could not repair storage. Check file permissions or preserve conflicting files before repair.',
      );
  }
  if (await exists(join(directory, 'restore.pending.json')))
    add(
      'restore-pending',
      join(directory, 'restore.pending.json'),
      'Restore was interrupted. Repeat repair --restore-from with the original snapshot.',
    );
  if (!owner && (await exists(ownerPaths(directory).socket)))
    add(
      'coordinator-stale',
      ownerPaths(directory).socket,
      'Coordinator socket has no responding owner; run repair.',
    );
  if (await exists(`${ownerPaths(directory).record}.repair`))
    add(
      'repair-lock',
      `${ownerPaths(directory).record}.repair`,
      'A repair lock exists. Confirm its owner has stopped before clearing it.',
    );
  if (!(await exists(directory))) add('directory-missing', directory, 'Data directory is missing.');
  else
    try {
      await access(directory, constants.W_OK);
    } catch {
      add('storage-unwritable', directory, 'Data directory is not writable.');
    }
  for (const name of ['connection.json', 'service.lock']) {
    const path = join(directory, name);
    if (!(await exists(path))) {
      if (live || owner)
        add('metadata-missing', path, 'Running service metadata is missing; run repair.');
      continue;
    }
    try {
      const info = OwnerSchema.parse(await json(path));
      if (live && info.instanceId !== live.instanceId)
        add('ownership-conflict', path, 'Metadata belongs to a different instance.');
      else if (!processExists(info.pid))
        add('stale-owner', path, 'Recorded owner has stopped; run repair.');
    } catch {
      add('metadata-damaged', path, 'Metadata cannot be read or validated.');
    }
  }
  let projects = 0;
  let sessions = 0;
  const registry = join(directory, 'projects.json');
  if (await exists(registry)) {
    try {
      projects = parseRegistry(await json(registry)).projects.length;
    } catch {
      add('registry-damaged', registry, 'Project registry is damaged; repair can try its backup.');
    }
  } else
    add(
      'registry-missing',
      registry,
      'Project registry is missing; repair or restart the Vite projects.',
    );
  for (const path of await feedbackPaths(directory)) {
    try {
      const data = parseFeedbackFile(await json(path));
      sessions += data.sessions.length;
      const store = new FeedbackStore(path, data.sessions, data.storageEpoch);
      for (const session of data.sessions) {
        for (const image of session.document.annotations.flatMap(
          (annotation) => annotation.images ?? [],
        )) {
          try {
            await store.getImage(session.document.id, image.id);
          } catch {
            add(
              'image-missing-or-damaged',
              join(`${path}.images`, session.document.id, `${image.id}.png`),
              'Reopen the browser/page holding this attachment to upload it again.',
            );
          }
        }
      }
    } catch {
      add(
        'feedback-damaged-or-missing',
        path,
        'Feedback cannot be loaded; repair can try its backup.',
      );
    }
  }
  return {
    directory,
    status: live ? 'running' : owner ? 'unavailable' : 'stopped',
    ...(live ? { pid: live.pid, instanceId: live.instanceId } : {}),
    projects,
    sessions,
    issues,
  };
}

/** Serializes offline repair and holds the same OS coordinator as normal startup. */
export async function withOfflineService<T>(directory: string, run: () => Promise<T>): Promise<T> {
  directory = await canonicalServiceDirectory(directory);
  if ((await liveConnection(directory)) || (await probeOwner(directory)))
    throw new ProjectError('Stop the shared service before this operation.');
  const paths = ownerPaths(directory);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const guardPath = `${paths.record}.repair`;
  const guard = await open(guardPath, 'wx', 0o600).catch(() => {
    throw new ProjectError(
      'Another repair is active. Inspect the coordinator repair lock before retrying.',
    );
  });
  let owner: Awaited<ReturnType<typeof acquireOwner>> | undefined;
  try {
    await guard.writeFile(JSON.stringify({ pid: process.pid }));
    for (const path of [
      join(directory, 'service.lock'),
      join(directory, 'connection.json'),
      paths.record,
    ]) {
      if (!(await exists(path))) continue;
      const info = OwnerSchema.safeParse(await json(path).catch(() => undefined));
      if (info.success && processExists(info.data.pid))
        throw new ProjectError(
          'A recorded service process is still alive. Inspect it before repair.',
        );
    }
    if (process.platform !== 'win32' && (await exists(paths.socket))) {
      if (await probeOwner(directory))
        throw new ProjectError('Service started during repair. Retry after stopping it.');
      await rm(paths.socket);
    }
    owner = await acquireOwner(directory, { pid: process.pid, instanceId: randomUUID() });
    return await run();
  } finally {
    try {
      await owner?.close();
    } finally {
      await guard.close();
      await rm(guardPath, { force: true });
    }
  }
}

export async function repairService(directory = defaultServiceDirectory(), resetDamaged = false) {
  directory = await canonicalServiceDirectory(directory);
  if (await exists(join(directory, 'restore.pending.json')))
    throw new ProjectError(
      'Finish the interrupted restore with repair --restore-from before repairing other files.',
    );
  const live = await liveConnection(directory);
  if (live) {
    if (resetDamaged)
      throw new ProjectError('Stop the service before explicitly resetting damaged storage.');
    // Explicit repair may quarantine corrupt discovery files, but never another valid owner.
    for (const name of ['connection.json', 'service.lock']) {
      const path = join(directory, name);
      if (!(await exists(path))) continue;
      const value = await json(path).catch(() => undefined);
      const owner = OwnerSchema.safeParse(value);
      if (owner.success && owner.data.instanceId !== live.instanceId)
        throw new ProjectError('Another instance owns service metadata; repair refused.');
      if (
        !owner.success ||
        (name === 'connection.json' && !ServiceConnectionSchema.safeParse(value).success)
      )
        await rename(path, `${path}.corrupt-${randomUUID()}`);
    }
    await serviceRequest(live, '/control/repair', { method: 'POST' });
  } else
    await withOfflineService(directory, async () => {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const registry = join(directory, 'projects.json');
      try {
        const restored = await readSnapshot(registry, parseRegistry);
        if (!restored.value) await writeSnapshot(registry, { version: 1, projects: [] });
      } catch (error) {
        if (!resetDamaged || (error as NodeJS.ErrnoException).code !== 'AINOTATION_STORAGE_DAMAGED')
          throw error;
        if (await exists(registry)) await rename(registry, `${registry}.corrupt-${randomUUID()}`);
        if (await exists(`${registry}.backup`))
          await rename(`${registry}.backup`, `${registry}.backup.corrupt-${randomUUID()}`);
        await writeSnapshot(registry, { version: 1, projects: [] });
      }
      for (const path of await feedbackPaths(directory)) {
        try {
          await createFeedbackStore({ filePath: path });
        } catch (error) {
          if (
            !resetDamaged ||
            (error as NodeJS.ErrnoException).code !== 'AINOTATION_STORAGE_DAMAGED'
          )
            throw error;
          if (await exists(path)) await rename(path, `${path}.corrupt-${randomUUID()}`);
          if (await exists(`${path}.backup`))
            await rename(`${path}.backup`, `${path}.backup.corrupt-${randomUUID()}`);
          await createFeedbackStore({ filePath: path });
        }
      }
      for (const name of ['connection.json', 'service.lock']) {
        const path = join(directory, name);
        if (await exists(path)) await rename(path, `${path}.stale-${randomUUID()}`);
      }
    });
  return diagnoseService(directory);
}
