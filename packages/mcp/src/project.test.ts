import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
  discoverProject,
  findProjectRoot,
  initializeProject,
  PROJECT_CONFIG_FILE,
  ProjectConfigSchema,
} from './project';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ainotation-project-')));
  directories.push(directory);
  // Keep ancestor discovery inside the fixture regardless of external directory layout.
  await mkdir(join(directory, '.git'));
  return directory;
}
async function manifest(directory: string, input: unknown) {
  await writeFile(join(directory, 'package.json'), JSON.stringify(input));
}

describe('project initialization', () => {
  it('creates a portable identity, detects Vite+ and leaves application and MCP configs unchanged', async () => {
    const directory = await temporary();
    await manifest(directory, {
      name: '@example/web',
      devDependencies: { 'vite-plus': 'catalog:' },
      scripts: { dev: 'vp dev' },
    });
    const vite = 'export default { plugins: [existingPlugin()] };\n';
    const mcp = '{"mcpServers":{"existing":{"command":"existing-server"}}}\n';
    await writeFile(join(directory, 'vite.config.ts'), vite);
    await writeFile(join(directory, '.mcp.json'), mcp);
    const beforeManifest = await readFile(join(directory, 'package.json'), 'utf8');
    const initialized = await initializeProject({ directory });
    expect(initialized.created).toBe(true);
    expect(initialized.root).toBe(directory);
    expect(initialized.toolchain).toEqual({ kind: 'vite-plus', configFiles: ['vite.config.ts'] });
    expect(initialized.config.name).toBe('@example/web');
    expect(ProjectConfigSchema.safeParse(initialized.config).success).toBe(true);
    const raw = await readFile(initialized.configPath, 'utf8');
    expect(JSON.parse(raw)).toEqual(initialized.config);
    expect(Object.keys(JSON.parse(raw))).toEqual(['version', 'projectId', 'name']);
    expect(raw).not.toContain(directory);
    expect(raw).not.toContain('token');
    expect(await readFile(join(directory, 'vite.config.ts'), 'utf8')).toBe(vite);
    expect(await readFile(join(directory, '.mcp.json'), 'utf8')).toBe(mcp);
    expect(await readFile(join(directory, 'package.json'), 'utf8')).toBe(beforeManifest);
  });

  it('reuses the identity and exact file contents on repeated initialization from a subdirectory', async () => {
    const directory = await temporary();
    await manifest(directory, { name: 'original', devDependencies: { vite: '^7' } });
    const first = await initializeProject({ directory, name: 'Web App' });
    const existing = `${JSON.stringify(first.config)}\n\n`;
    await writeFile(first.configPath, existing);
    const child = join(directory, 'src', 'components');
    await mkdir(child, { recursive: true });
    const repeated = await initializeProject({ directory: child, name: 'Ignored new name' });
    expect(repeated.created).toBe(false);
    expect(repeated.config).toEqual(first.config);
    expect(repeated.toolchain.kind).toBe('vite');
    expect(await readFile(first.configPath, 'utf8')).toBe(existing);
    expect(await findProjectRoot(child)).toBe(directory);
    expect((await discoverProject(child))?.config.projectId).toBe(first.config.projectId);
  });

  it('gives nested Web applications independent identities instead of adopting a parent project', async () => {
    const root = await temporary();
    await manifest(root, { name: 'workspace' });
    const workspace = await initializeProject({ directory: root });
    const a = join(root, 'apps', 'a');
    const b = join(root, 'apps', 'b');
    await Promise.all([mkdir(a, { recursive: true }), mkdir(b, { recursive: true })]);
    await manifest(a, { name: 'web-a', dependencies: { vite: 'catalog:' } });
    await manifest(b, { name: 'web-b' });
    await writeFile(join(b, 'vite.config.mjs'), 'export default {};');
    expect(await discoverProject(a)).toBeUndefined();
    const [first, second] = await Promise.all([
      initializeProject({ directory: a }),
      initializeProject({ directory: b }),
    ]);
    expect(
      new Set([workspace.config.projectId, first.config.projectId, second.config.projectId]).size,
    ).toBe(3);
    expect(first.root).toBe(a);
    expect(second.root).toBe(b);
    expect(first.toolchain.kind).toBe('vite');
    expect(second.toolchain.kind).toBe('vite');
    expect(second.toolchain.configFiles).toEqual(['vite.config.mjs']);
  });

  it('publishes one complete identity under concurrent initialization and cleans temporary files', async () => {
    const directory = await temporary();
    const results = await Promise.all(
      Array.from({ length: 8 }, () => initializeProject({ directory })),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.config.projectId)).size).toBe(1);
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['.git', PROJECT_CONFIG_FILE]));
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(
      ProjectConfigSchema.parse(
        JSON.parse(await readFile(join(directory, PROJECT_CONFIG_FILE), 'utf8')),
      ),
    ).toEqual(results[0]!.config);
  });

  it.each(['{"broken":', '{"version":2,"projectId":"invalid","name":"Example"}', 'null'])(
    'rejects an invalid existing project config without overwriting it: %s',
    async (contents) => {
      const directory = await temporary();
      await writeFile(join(directory, PROJECT_CONFIG_FILE), contents);
      await expect(initializeProject({ directory })).rejects.toThrow();
      await expect(discoverProject(directory)).rejects.toThrow();
      expect(await readFile(join(directory, PROJECT_CONFIG_FILE), 'utf8')).toBe(contents);
    },
  );

  it('rejects malformed manifests, unsafe names and oversized configuration before creating files', async () => {
    const directory = await temporary();
    await manifest(directory, null);
    await expect(initializeProject({ directory })).rejects.toThrow('invalid project metadata');
    await manifest(directory, { name: 'app' });
    await expect(initializeProject({ directory, name: '\u001b[31mBad name' })).rejects.toThrow(
      'project name',
    );
    await writeFile(join(directory, PROJECT_CONFIG_FILE), ' '.repeat(65537));
    await expect(initializeProject({ directory })).rejects.toThrow('64 KiB');
    expect((await readdir(directory)).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('resolves symlinked roots consistently and stops at an independent repository boundary', async () => {
    const parent = await temporary();
    await initializeProject({ directory: parent });
    const nested = join(parent, 'nested');
    await mkdir(join(nested, '.git'), { recursive: true });
    expect(await discoverProject(nested)).toBeUndefined();
    const initialized = await initializeProject({ directory: nested, name: 'Separate repo' });
    const alias = join(parent, 'alias');
    await symlink(nested, alias, 'dir');
    expect((await discoverProject(alias))?.root).toBe(nested);
    expect((await initializeProject({ directory: alias })).config).toEqual(initialized.config);
  });

  it('fails for missing directories and dangling config links without creating anything', async () => {
    const directory = await temporary();
    await expect(initializeProject({ directory: join(directory, 'missing') })).rejects.toThrow(
      'existing readable directory',
    );
    await symlink(join(directory, 'missing-config'), join(directory, PROJECT_CONFIG_FILE));
    await expect(initializeProject({ directory })).rejects.toThrow('Cannot read');
    expect(await readdir(directory)).toEqual(expect.arrayContaining(['.git', PROJECT_CONFIG_FILE]));
  });
});
