import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { runCli } from './cli-commands';
import { ProjectConfigSchema } from './project';

const directories: string[] = [];
async function temporary() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ainotation-init-cli-')));
  directories.push(directory);
  await mkdir(join(directory, '.git'));
  return directory;
}
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

it('returns structured init and inspection results without starting the server', async () => {
  const directory = await temporary();
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'cli-app', scripts: { dev: 'vp dev' } }),
  );
  let output = '';
  const context = {
    directory,
    output: (text: string) => {
      output += text;
    },
  };
  await runCli(['init', '--json'], context);
  const first = JSON.parse(output);
  expect(first.created).toBe(true);
  expect(ProjectConfigSchema.parse(first.config).name).toBe('cli-app');
  expect(first.toolchain.kind).toBe('vite-plus');
  output = '';
  await runCli(['project', '--json', '--data-dir', join(directory, 'service')], context);
  expect(JSON.parse(output)).toEqual({
    root: first.root,
    configPath: first.configPath,
    config: first.config,
    toolchain: first.toolchain,
  });
  output = '';
  await runCli(['init', '--name', 'Keep existing identity'], context);
  expect(output).toContain('Using existing project identity');
  expect(output).toContain('Project: cli-app');
  expect(output).not.toContain('Pairing token');
  expect(JSON.parse(await readFile(first.configPath, 'utf8')).projectId).toBe(
    first.config.projectId,
  );
});

it('honors explicit directory and name options', async () => {
  const base = await temporary();
  const directory = join(base, 'web app');
  await mkdir(directory);
  await writeFile(join(directory, 'package.json'), '{}');
  let output = '';
  await runCli(['init', '--directory', directory, '--name', '网页项目', '--json'], {
    directory: base,
    output: (text) => {
      output += text;
    },
  });
  const result = JSON.parse(output);
  expect(result.root).toBe(directory);
  expect(result.config.name).toBe('网页项目');
  expect(result.toolchain.kind).toBe('unknown');
  expect(await readdir(base)).not.toContain('ainotation.config.json');
});

it('prints help without touching the project and rejects unsupported commands or options', async () => {
  const directory = await temporary();
  let output = '';
  const context = {
    directory,
    output: (text: string) => {
      output += text;
    },
  };
  for (const args of [['--help'], ['init', '--help'], ['project', '--help']])
    await runCli(args, context);
  expect(output).toContain('Usage: ainotation-mcp');
  expect(await readdir(directory)).toEqual(['.git']);
  await expect(runCli(['not-a-command'], context)).rejects.toThrow('Unknown command');
  await expect(runCli(['init', '--token', 'NOT_A_CONFIG_SECRET'], context)).rejects.toThrow(
    'Invalid project command options',
  );
  await expect(runCli(['project', '--name', 'unexpected'], context)).rejects.toThrow(
    'Invalid project command options',
  );
  await expect(
    runCli(['project', '--data-dir', join(directory, 'service')], context),
  ).rejects.toThrow('not initialized');
  expect(await readdir(directory)).toEqual(['.git']);
});
