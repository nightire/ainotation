import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, expect, it } from 'vite-plus/test';
import { createProjectBinding } from './project-binding';
import { initializeProject } from './project';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ainotation-binding-')));
  directories.push(root);
  await mkdir(join(root, '.git'));
  const a = join(root, 'a');
  const b = join(root, 'b');
  for (const directory of [a, b]) {
    await mkdir(directory);
    await writeFile(join(directory, 'package.json'), '{}');
    await initializeProject({ directory });
  }
  return { root, a, b };
}

it('explicit directory wins over Agent roots and is relative to the startup directory', async () => {
  const { root, a, b } = await setup();
  const binding = createProjectBinding({
    cwd: root,
    directory: 'a',
    roots: async () => [{ uri: pathToFileURL(b).href }],
  });
  expect((await binding.resolve()).root).toBe(a);
  expect(binding.invalidate()).toBe(false);
  expect((await binding.resolve()).root).toBe(a);
});

it('uses a single Agent project, coalesces duplicate roots and otherwise falls back to cwd', async () => {
  const { root, a } = await setup();
  const nested = join(a, 'src');
  await mkdir(nested);
  const binding = createProjectBinding({
    cwd: root,
    roots: async () => [{ uri: pathToFileURL(a).href }, { uri: pathToFileURL(nested).href }],
  });
  expect(binding.invalidate()).toBe(false);
  expect((await binding.resolve()).root).toBe(a);
  expect((await createProjectBinding({ cwd: nested }).resolve()).root).toBe(a);
});

it('rejects multiple, absent, remote or uninitialized roots instead of exposing all projects', async () => {
  const { root, a, b } = await setup();
  for (const roots of [
    [],
    [{ uri: pathToFileURL(a).href }, { uri: pathToFileURL(b).href }],
    [{ uri: 'https://example.com' }],
    [{ uri: pathToFileURL(root).href }],
  ]) {
    await expect(
      createProjectBinding({ cwd: a, roots: async () => roots }).resolve(),
    ).rejects.toThrow();
  }
});

it('refuses to switch a bound connection when roots or project identity change', async () => {
  const { a, b } = await setup();
  let current = a;
  const binding = createProjectBinding({
    cwd: a,
    roots: async () => [{ uri: pathToFileURL(current).href }],
  });
  await binding.resolve();
  current = b;
  await expect(binding.resolve()).rejects.toThrow('Workspace roots changed');
  current = a;
  expect(binding.invalidate()).toBe(false);
  await expect(binding.resolve()).rejects.toThrow('Workspace roots changed');
});
