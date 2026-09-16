import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { writePrivateJson } from './atomic-json';
import { createProjectService } from './project-service';
import { startProjectHttpServer } from './project-http';
import { ProjectError } from './project';
import { acquireOwner, removeOwnedFile } from './service-owner';
import { StoreError } from './store';
import { exists } from './recovery-json';
export { ownerPaths as serviceOwnerPaths } from './service-owner';

export const ServiceConnectionSchema = z
  .object({
    version: z.literal(1),
    instanceId: z.uuid(),
    pid: z.number().int().positive(),
    url: z.string().refine((value) => {
      try {
        const url = new URL(value);
        return (
          url.protocol === 'http:' &&
          url.hostname === '127.0.0.1' &&
          url.port !== '' &&
          url.origin === value
        );
      } catch {
        return false;
      }
    }),
    token: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ServiceConnection = z.infer<typeof ServiceConnectionSchema>;
export const defaultServiceDirectory = () => join(homedir(), '.ainotation', 'service');

/** Local Node integrations read this file; never send this credential to a browser. */
export async function readServiceConnection(
  directory = defaultServiceDirectory(),
): Promise<ServiceConnection | undefined> {
  try {
    return ServiceConnectionSchema.parse(
      JSON.parse(await readFile(join(directory, 'connection.json'), 'utf8')),
    );
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new ProjectError('Cannot read local service connection. Check the service directory.', {
      cause: error,
    });
  }
}

export async function startSharedService(
  options: { directory?: string; port?: number; leaseMs?: number } = {},
) {
  const requested = resolve(options.directory ?? defaultServiceDirectory());
  await mkdir(requested, { recursive: true, mode: 0o700 });
  const directory = await realpath(requested);
  const lockPath = join(directory, 'service.lock');
  const connectionPath = join(directory, 'connection.json');
  const instanceId = randomUUID();
  const identity = { instanceId, pid: process.pid };
  const owner = await acquireOwner(directory, identity);
  let lock;
  try {
    if (await exists(join(directory, 'restore.pending.json'))) {
      throw new ProjectError(
        'An external restore was interrupted. Run repair --restore-from with the same snapshot before starting the service.',
      );
    }
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    await owner.close();
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new ProjectError(
        'This service directory is already locked. If a previous service crashed, verify it has stopped before removing service.lock.',
      );
    }
    throw error;
  }
  const token = randomBytes(32).toString('hex');
  let service: Awaited<ReturnType<typeof createProjectService>> | undefined;
  let http: Awaited<ReturnType<typeof startProjectHttpServer>> | undefined;
  let closing: Promise<void> | undefined;
  let connection: ServiceConnection | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let repairing: Promise<void> | undefined;
  let maintenanceHealthy = true;
  async function ownership() {
    if (!connection || closing) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    for (const [path, value] of [
      [lockPath, identity],
      [connectionPath, connection],
    ] as const) {
      try {
        const saved = JSON.parse(await readFile(path, 'utf8')) as {
          instanceId?: string;
          pid?: number;
        };
        if (saved.instanceId !== instanceId || saved.pid !== process.pid)
          throw new ProjectError(
            'Service ownership changed. Run ainotation-mcp doctor before reconnecting.',
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new StoreError(
            503,
            'Service ownership metadata needs repair. Run ainotation-mcp doctor.',
            'service-ownership',
          );
        await writePrivateJson(path, value);
      }
    }
  }
  function repair() {
    if (closing) return Promise.reject(new StoreError(503, 'Service is closing'));
    repairing ??= (async () => {
      try {
        await ownership();
        await service?.repair();
        maintenanceHealthy = true;
      } catch (error) {
        maintenanceHealthy = false;
        throw error;
      }
    })().finally(() => {
      repairing = undefined;
    });
    return repairing;
  }
  const close = (): Promise<void> => {
    closing ??= (async () => {
      clearInterval(timer);
      try {
        await repairing?.catch(() => {});
        await http?.close();
        await service?.close();
      } finally {
        try {
          await removeOwnedFile(connectionPath, instanceId);
        } finally {
          try {
            await lock.close();
          } finally {
            try {
              await removeOwnedFile(lockPath, instanceId);
            } finally {
              await owner.close();
            }
          }
        }
      }
    })();
    return closing;
  };
  try {
    await lock.writeFile(JSON.stringify({ instanceId, pid: process.pid }));
    await lock.sync();
    service = await createProjectService({
      directory,
      ...(options.leaseMs !== undefined ? { leaseMs: options.leaseMs } : {}),
    });
    http = await startProjectHttpServer({
      service,
      controlToken: token,
      instanceId,
      beforeRequest: ownership,
      repair,
      maintenanceHealthy: () => maintenanceHealthy,
      ...(options.port !== undefined ? { port: options.port } : {}),
    });
    connection = ServiceConnectionSchema.parse({
      version: 1,
      instanceId,
      pid: process.pid,
      url: http.url,
      token,
    });
    await writePrivateJson(connectionPath, connection);
    await owner.publish(connection);
    timer = setInterval(() => {
      void repair().catch(() => {});
    }, 2000);
    timer.unref();
    return { directory, connection, close, repair };
  } catch (error) {
    await close();
    throw error;
  }
}
