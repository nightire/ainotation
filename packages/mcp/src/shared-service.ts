import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, realpath, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { writePrivateJson } from './atomic-json';
import { createProjectService } from './project-service';
import { startProjectHttpServer } from './project-http';
import { ProjectError } from './project';

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
  let lock;
  try {
    lock = await open(lockPath, 'wx', 0o600);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
      throw new ProjectError(
        'This service directory is already locked. If a previous service crashed, verify it has stopped before removing service.lock.',
      );
    }
    throw error;
  }
  const instanceId = randomUUID();
  const token = randomBytes(32).toString('hex');
  let service: Awaited<ReturnType<typeof createProjectService>> | undefined;
  let http: Awaited<ReturnType<typeof startProjectHttpServer>> | undefined;
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closing ??= (async () => {
      try {
        await http?.close();
        await service?.close();
      } finally {
        try {
          await rm(connectionPath, { force: true });
        } finally {
          await lock.close();
          await rm(lockPath, { force: true });
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
      ...(options.port !== undefined ? { port: options.port } : {}),
    });
    const connection = ServiceConnectionSchema.parse({
      version: 1,
      instanceId,
      pid: process.pid,
      url: http.url,
      token,
    });
    await writePrivateJson(connectionPath, connection);
    return { directory, connection, close };
  } catch (error) {
    await close();
    throw error;
  }
}
