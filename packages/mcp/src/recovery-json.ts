import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writePrivateJson } from './atomic-json';

export async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function readSnapshot<T>(
  path: string,
  parse: (value: unknown) => T,
): Promise<{ value?: T; recovered: boolean }> {
  let failure: unknown;
  try {
    return { value: parse(JSON.parse(await readFile(path, 'utf8'))), recovered: false };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code && (error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error;
    failure = error;
  }
  try {
    const value = parse(JSON.parse(await readFile(`${path}.backup`, 'utf8')));
    if (await exists(path)) await rename(path, `${path}.corrupt-${randomUUID()}`);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writePrivateJson(path, value);
    return { value, recovered: true };
  } catch (error) {
    if (
      (failure as NodeJS.ErrnoException).code === 'ENOENT' &&
      (error as NodeJS.ErrnoException).code === 'ENOENT'
    )
      return { recovered: false };
    throw Object.assign(
      new Error(
        'Storage is damaged and has no usable backup. Run ainotation-mcp doctor; preserve the files before repair.',
        { cause: error },
      ),
      { code: 'AINOTATION_STORAGE_DAMAGED' },
    );
  }
}

/** One previous validated snapshot, atomically published before the new primary. */
export async function writeSnapshot(path: string, value: unknown, previous?: unknown) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writePrivateJson(`${path}.backup`, previous ?? value);
  await writePrivateJson(path, value);
}
