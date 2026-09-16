import { spawn } from 'node:child_process';
import { mkdir, readFile, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveServiceExecutable } from './service-executable';
import { z } from 'zod';
import {
  defaultServiceDirectory,
  readServiceConnection,
  type ServiceConnection,
} from './shared-service';
import { serviceRequest } from './service-client';
import { ProjectError } from './project';
import { StoreError } from './store';
import { ownerPaths, probeOwner, canonicalServiceDirectory } from './service-owner';
import { ServiceConnectionSchema } from './shared-service';

const HealthSchema = z.object({ ok: z.literal(true), version: z.literal(1), instanceId: z.uuid() });

async function healthy(connection: ServiceConnection, signal?: AbortSignal): Promise<boolean> {
  try {
    const result = HealthSchema.parse(
      await serviceRequest(connection, '/control/health', {
        ...(signal ? { signal } : {}),
        timeoutMs: 1000,
      }),
    );
    if (result.instanceId !== connection.instanceId)
      throw new ProjectError('Shared service identity does not match its connection file.');
    return true;
  } catch (error) {
    if (signal?.aborted) throw error;
    if (
      error instanceof ProjectError ||
      (error instanceof StoreError && error.status !== 503) ||
      error instanceof z.ZodError
    )
      throw new ProjectError(
        'Cannot verify the shared service. Check its connection file and restart it.',
        { cause: error },
      );
    return false;
  }
}

/** Discover only the selected local service directory, never scan ports or other projects. */
export async function ensureSharedService(
  options: {
    directory?: string;
    cliPath?: string;
    signal?: AbortSignal;
    startupTimeoutMs?: number;
  } = {},
): Promise<ServiceConnection> {
  const { signal } = options;
  signal?.throwIfAborted();
  const requested = resolve(options.directory ?? defaultServiceDirectory());
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const directory = await realpath(requested);
  const deadline = Date.now() + (options.startupTimeoutMs ?? 10000);
  let started = false;
  let launchError: Error | undefined;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    const owner = await probeOwner(directory);
    const connection = await readServiceConnection(directory);
    if (
      connection &&
      owner &&
      (connection.instanceId !== owner.instanceId || connection.pid !== owner.pid)
    )
      throw new ProjectError(
        'Cannot verify the shared service: coordinator ownership does not match connection.json.',
      );
    if (connection && (await healthy(connection, signal))) return connection;
    if (owner) {
      try {
        const remembered = ServiceConnectionSchema.parse(
          JSON.parse(await readFile(ownerPaths(directory).record, 'utf8')),
        );
        if (remembered.instanceId !== owner.instanceId || remembered.pid !== owner.pid)
          throw new ProjectError(
            'Coordinator ownership does not match its private record. Run ainotation-mcp doctor.',
          );
        if (await healthy(remembered, signal)) {
          await serviceRequest(remembered, '/control/repair', {
            method: 'POST',
            ...(signal ? { signal } : {}),
          });
          return remembered;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await delay(50, undefined, signal ? { signal } : {});
      continue;
    }
    let locked = false;
    try {
      const lock = await readFile(join(directory, 'service.lock'), 'utf8');
      locked = true;
      try {
        const owner = z
          .object({ pid: z.number().int().positive(), instanceId: z.uuid() })
          .parse(JSON.parse(lock));
        try {
          process.kill(owner.pid, 0);
        } catch (error) {
          if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
            throw new ProjectError(
              'A previous shared service stopped without releasing service.lock. Verify it has stopped and remove the stale lock before reconnecting.',
            );
        }
      } catch (error) {
        if (error instanceof ProjectError)
          throw error; /* Owner may still be writing the new lock. */
      }
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    if (!locked && !started) {
      const cliPath = await resolveServiceExecutable(options.cliPath);
      signal?.throwIfAborted();
      const child = spawn(process.execPath, [cliPath, 'service', '--data-dir', directory], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      });
      child.once('error', (error) => {
        launchError = error;
      });
      child.unref();
      started = true;
    }
    if (launchError)
      throw new ProjectError('Cannot start the shared service.', { cause: launchError });
    await delay(50, undefined, signal ? { signal } : {});
  }
  throw new ProjectError(
    'Shared service did not become ready. Run "ainotation-mcp service" with the same data directory to inspect startup errors.',
  );
}

/** Explicit operator action; never used by automatic discovery or pairing. */
export async function stopSharedService(directory = defaultServiceDirectory()): Promise<boolean> {
  directory = await canonicalServiceDirectory(directory);
  let connection = await readServiceConnection(directory);
  const owner = await probeOwner(directory);
  if (
    connection &&
    owner &&
    (connection.instanceId !== owner.instanceId || connection.pid !== owner.pid)
  )
    throw new ProjectError(
      'Cannot stop a service with conflicting coordinator ownership. Run ainotation-mcp doctor.',
    );
  if (!connection && (await probeOwner(directory)))
    connection = await ensureSharedService({ directory });
  if (!connection) return false;
  if (!(await healthy(connection)))
    throw new ProjectError(
      'Cannot verify the service to stop. Inspect the connection file and process manually.',
    );
  if (connection.pid === process.pid)
    throw new ProjectError(
      'Cannot stop a service hosted by the calling process. Use its close method.',
    );
  const current = await readServiceConnection(directory);
  if (current?.instanceId !== connection.instanceId)
    throw new ProjectError('Service changed during shutdown. Retry the stop command.');
  process.kill(connection.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 100; attempt++) {
    const next = await readServiceConnection(directory);
    if (!next || next.instanceId !== connection.instanceId) return true;
    await delay(50);
  }
  throw new ProjectError(
    'Service shutdown is still pending. Check the service process before restarting it.',
  );
}
