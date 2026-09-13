import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { declareProject, projectIdFor, ProjectConfigSchema } from './project';
import { createProjectService } from './project-service';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'ainotation-declarations-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, '.git'));
  const apps = [join(directory, 'a'), join(directory, 'b')];
  for (const app of apps) {
    await mkdir(app);
    await writeFile(join(app, 'package.json'), '{}');
  }
  const service = await createProjectService({ directory: join(directory, 'service') });
  cleanup.push(() => service.close());
  return { directory, apps, service };
}

it('derives a stable identity from name or id without writing project files', async () => {
  const { apps } = await setup();
  const first = await declareProject(apps[0]!, { name: 'acme/admin' });
  const next = await declareProject(apps[1]!, { name: 'acme/admin' });
  expect(first.config.projectId).toBe(next.config.projectId);
  expect(first.configPath).toBeUndefined();
  expect(await readdir(apps[0]!)).toEqual(['package.json']);
  expect(ProjectConfigSchema.safeParse(first.config).success).toBe(true);
  const renamed = await declareProject(apps[0]!, { name: '管理后台', id: 'acme/admin' });
  expect(renamed.config.projectId).toBe(first.config.projectId);
  expect(projectIdFor('different')).not.toBe(first.config.projectId);
  expect(projectIdFor('cafe\u0301')).toBe(projectIdFor('café'));
});

it('preserves an explicit legacy UUID and validates user-facing keys', () => {
  const id = '9966c904-ab78-4576-a233-00082bc77d5f';
  expect(projectIdFor(id)).toBe(id);
  expect(projectIdFor(id.toUpperCase())).toBe(id);
  expect(() => projectIdFor(' ')).toThrow();
  expect(() => projectIdFor('invalid\u001bkey')).toThrow();
});

it('registers config-free projects and rejects duplicate keys across roots or identity changes within a root', async () => {
  const { apps, service } = await setup();
  const a = await service.register(apps[0]!, { name: 'Admin', id: 'acme/admin' });
  expect(await service.resolveProject(apps[0]!)).toEqual(a);
  expect(
    await service.register(apps[0]!, { name: 'New display name', id: 'acme/admin' }),
  ).toMatchObject({ projectId: a.projectId, name: 'New display name' });
  await expect(
    service.register(apps[1]!, { name: 'Other app', id: 'acme/admin' }),
  ).rejects.toMatchObject({ status: 409 });
  await expect(service.register(apps[0]!, { name: 'Different identity' })).rejects.toMatchObject({
    status: 409,
  });
  const b = await service.register(apps[1]!, { name: 'acme/store' });
  expect(b.projectId).not.toBe(a.projectId);
  expect(await readdir(apps[0]!)).toEqual(['package.json']);
});

it('resolves one registered child from a workspace root but rejects multiple Web apps', async () => {
  const { directory, apps, service } = await setup();
  expect(await service.resolveProject(directory)).toBeUndefined();
  const a = await service.register(apps[0]!, { name: 'first' });
  expect(await service.resolveProject(directory)).toEqual(a);
  await service.register(apps[1]!, { name: 'second' });
  await expect(service.resolveProject(directory)).rejects.toMatchObject({ status: 409 });
  expect(await service.resolveProject(apps[0]!)).toEqual(a);
});

it('supports distinct Vite roots without nested package manifests and resolves their source folders', async () => {
  const { directory, service } = await setup();
  const first = join(directory, 'sites', 'first');
  const second = join(directory, 'sites', 'second');
  await mkdir(join(first, 'src'), { recursive: true });
  await mkdir(second, { recursive: true });
  const a = await service.register(first, { name: 'first-site' });
  const b = await service.register(second, { name: 'second-site' });
  expect(a.root).not.toBe(b.root);
  expect((await service.resolveProject(join(first, 'src')))?.projectId).toBe(a.projectId);
  await expect(service.resolveProject(directory)).rejects.toMatchObject({ status: 409 });
});
