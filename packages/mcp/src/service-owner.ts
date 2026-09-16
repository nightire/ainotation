import { createHash } from 'node:crypto';
import { createServer, createConnection } from 'node:net';
import { mkdir, readFile, rm, lstat, realpath } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { z } from 'zod';
import { writePrivateJson } from './atomic-json';
import { ProjectError } from './project';

export const OwnerSchema = z.object({ instanceId: z.uuid(), pid: z.number().int().positive() });
export async function canonicalServiceDirectory(input: string): Promise<string> {
  const path = resolve(input);
  try {
    return await realpath(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
    return join(await canonicalServiceDirectory(dirname(path)), basename(path));
  }
}
export function ownerPaths(directory: string) {
  const user = createHash('sha256').update(userInfo().username).digest('hex').slice(0, 8);
  const key = createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 24);
  const root = join(tmpdir(), `ainotation-${user}`);
  return {
    root,
    record: join(root, `${key}.json`),
    socket:
      process.platform === 'win32'
        ? `\\\\.\\pipe\\ainotation-${user}-${key}`
        : join(root, `${key}.sock`),
  };
}

/** The OS-held listener remains alive when the data directory is deleted. No credentials on IPC. */
export async function probeOwner(
  directory: string,
): Promise<z.infer<typeof OwnerSchema> | undefined> {
  directory = await canonicalServiceDirectory(directory);
  try {
    const info = await lstat(ownerPaths(directory).root);
    if (
      !info.isDirectory() ||
      (process.getuid && info.uid !== process.getuid()) ||
      (process.platform !== 'win32' && info.mode & 0o077)
    )
      throw new ProjectError('Service coordinator directory must be private to the current user.');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  return new Promise((resolve, reject) => {
    // Socket access is confined by the private runtime directory on Unix.
    const socket = createConnection(ownerPaths(directory).socket);
    let data = '';
    socket.setTimeout(1000, () =>
      socket.destroy(new Error('Service coordinator did not respond.')),
    );
    socket.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > 4096) socket.destroy(new Error('Invalid coordinator response.'));
    });
    socket.on('end', () => {
      try {
        resolve(OwnerSchema.parse(JSON.parse(data)));
      } catch (error) {
        reject(error);
      }
    });
    socket.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT' || error.code === 'ECONNREFUSED') resolve(undefined);
      else reject(error);
    });
  });
}

export async function removeOwnedFile(path: string, instanceId: string) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as { instanceId?: string };
    if (value.instanceId === instanceId) await rm(path, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' && !(error instanceof SyntaxError))
      throw error;
  }
}

export async function acquireOwner(directory: string, identity: z.infer<typeof OwnerSchema>) {
  const paths = ownerPaths(directory);
  await mkdir(paths.root, { recursive: true, mode: 0o700 });
  const info = await lstat(paths.root);
  if (
    !info.isDirectory() ||
    (process.getuid && info.uid !== process.getuid()) ||
    (process.platform !== 'win32' && info.mode & 0o077)
  )
    throw new ProjectError('Service coordinator directory must be private to the current user.');
  const server = createServer((socket) => {
    socket.on('error', () => {});
    socket.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', (error: NodeJS.ErrnoException) =>
      reject(
        new ProjectError(
          error.code === 'EADDRINUSE'
            ? 'Service coordinator is already locked. Run ainotation-mcp doctor, then repair if the owner has stopped.'
            : 'Cannot acquire the service coordinator.',
          { cause: error },
        ),
      ),
    );
    server.listen(paths.socket, () => {
      server.removeAllListeners('error');
      resolve();
    });
  });
  server.on('error', () => {});
  return {
    async publish(connection: unknown) {
      await writePrivateJson(paths.record, connection);
    },
    async close() {
      // Keep ownership until all state cleanup has finished.
      try {
        await removeOwnedFile(paths.record, identity.instanceId);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    },
  };
}
