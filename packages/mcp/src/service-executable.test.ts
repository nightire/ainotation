import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vite-plus/test';
import { resolveServiceExecutable } from './service-executable';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-executable-'));
  directories.push(root);
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'dist'));
  const cli = join(root, 'dist', 'cli.mjs');
  await writeFile(cli, '');
  return { root, cli };
}

it.each(['src/service-executable.ts', 'dist/service-executable.mjs'])(
  'locates the built CLI from %s without an override',
  async (module) => {
    const { root, cli } = await fixture();
    expect(await resolveServiceExecutable(undefined, pathToFileURL(join(root, module)).href)).toBe(
      cli,
    );
  },
);

it('honors explicit paths and reports a missing override without falling back', async () => {
  const { root, cli } = await fixture();
  const override = join(root, 'custom.mjs');
  await writeFile(override, '');
  const moduleUrl = pathToFileURL(join(root, 'src/service-executable.ts')).href;
  expect(await resolveServiceExecutable(override, moduleUrl)).toBe(override);
  await expect(resolveServiceExecutable(join(root, 'missing.mjs'), moduleUrl)).rejects.toThrow(
    'Build or install',
  );
  await rm(cli);
  await expect(resolveServiceExecutable(undefined, moduleUrl)).rejects.toThrow('Build or install');
});
