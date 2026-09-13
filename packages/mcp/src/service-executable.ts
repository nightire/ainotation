import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ProjectError } from './project';

/** Resolve only known package layouts; do not search PATH or unrelated workspaces. */
export async function resolveServiceExecutable(
  override?: string,
  moduleUrl = import.meta.url,
): Promise<string> {
  const candidates = override
    ? [override]
    : [
        fileURLToPath(new URL('./cli.mjs', moduleUrl)),
        ...(new URL(moduleUrl).pathname.endsWith('.ts')
          ? [fileURLToPath(new URL('../dist/cli.mjs', moduleUrl))]
          : []),
      ];
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  throw new ProjectError('Build or install the Ainotation CLI before starting its shared service.');
}
