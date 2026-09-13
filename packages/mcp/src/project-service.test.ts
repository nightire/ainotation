import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';
import { createProjectService, type ProjectService } from './project-service';
import { initializeProject } from './project';
import { fixture, origin } from './fixtures';

const roots: string[] = [];
const services: ProjectService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-project-service-'));
  roots.push(root);
  const a = join(root, 'a');
  const b = join(root, 'b');
  await Promise.all([mkdir(a), mkdir(b)]);
  await Promise.all([
    writeFile(join(a, 'package.json'), '{"name":"project-a"}'),
    writeFile(join(b, 'package.json'), '{"name":"project-b"}'),
  ]);
  await Promise.all([initializeProject({ directory: a }), initializeProject({ directory: b })]);
  let time = 1000;
  const directory = join(root, 'service');
  const service = await createProjectService({ directory, leaseMs: 100, now: () => time });
  services.push(service);
  const [first, second] = await Promise.all([service.register(a), service.register(b)]);
  return {
    root,
    directory,
    service,
    first,
    second,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

it('binds every grant to one project, one role and the exact browser origin', async () => {
  const { service, first, second } = await setup();
  const browserA = service.issue({ kind: 'browser', projectId: first.projectId, origin });
  const browserB = service.issue({ kind: 'browser', projectId: second.projectId, origin });
  const agentA = service.issue({ kind: 'agent', projectId: first.projectId });
  const agentB = service.issue({ kind: 'agent', projectId: second.projectId });
  const a = await service.authorize(`Bearer ${browserA.token}`, origin);
  const b = await service.authorize(`Bearer ${browserB.token}`, origin);
  const document = fixture();
  await a.store.sync(document.id, { document, operations: [] }, origin);
  const other = structuredClone(document);
  other.annotations[0]!.comment = 'Project B only';
  await b.store.sync(other.id, { document: other, operations: [] }, origin);
  expect(
    (await service.authorize(`Bearer ${agentA.token}`)).store.list()[0]!.annotations[0]!.comment,
  ).toBe(document.annotations[0]!.comment);
  expect(
    (await service.authorize(`Bearer ${agentB.token}`)).store.list()[0]!.annotations[0]!.comment,
  ).toBe('Project B only');
  await expect(service.authorize(`Bearer ${browserA.token}`)).rejects.toMatchObject({
    status: 403,
  });
  await expect(
    service.authorize(`Bearer ${browserA.token}`, 'http://localhost:9999'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(service.authorize(`Bearer ${agentA.token}`, origin)).rejects.toMatchObject({
    status: 403,
  });
  await expect(service.authorize('Bearer forged')).rejects.toMatchObject({ status: 401 });
});

it('renews live leases and revokes expired connections without changing project data', async () => {
  const { service, first, advance } = await setup();
  const grant = service.issue({ kind: 'browser', projectId: first.projectId, origin });
  const scope = await service.authorize(`Bearer ${grant.token}`, origin);
  advance(90);
  expect(service.renew(grant.grantId).expiresAt).toBe(1190);
  advance(50);
  expect(service.allowsOrigin(origin)).toBe(true);
  expect(scope.signal.aborted).toBe(false);
  advance(50);
  service.expire();
  expect(scope.signal.aborted).toBe(true);
  expect(service.allowsOrigin(origin)).toBe(false);
  expect(() => service.renew(grant.grantId)).toThrow('expired or revoked');
  await expect(service.authorize(`Bearer ${grant.token}`, origin)).rejects.toMatchObject({
    status: 401,
  });
  const next = service.issue({ kind: 'agent', projectId: first.projectId });
  const agent = await service.authorize(`Bearer ${next.token}`);
  service.revoke(next.grantId);
  service.revoke(next.grantId);
  expect(agent.signal.aborted).toBe(true);
});

it('persists project stores independently and requires fresh grants after restart', async () => {
  const { directory, service, first, second } = await setup();
  const grant = service.issue({ kind: 'browser', projectId: first.projectId, origin });
  const { store } = await service.authorize(`Bearer ${grant.token}`, origin);
  const document = fixture();
  const secondGrant = service.issue({ kind: 'browser', projectId: second.projectId, origin });
  const secondStore = (await service.authorize(`Bearer ${secondGrant.token}`, origin)).store;
  const secondDocument = structuredClone(document);
  secondDocument.annotations[0]!.comment = 'Persisted B';
  await secondStore.sync(secondDocument.id, { document: secondDocument, operations: [] }, origin);
  const pending = store.sync(document.id, { document, operations: [] }, origin);
  await service.close();
  await pending;
  const reopened = await createProjectService({ directory });
  services.push(reopened);
  expect(
    reopened
      .listProjects()
      .map((project) => project.projectId)
      .sort(),
  ).toEqual([first.projectId, second.projectId].sort());
  await expect(reopened.authorize(`Bearer ${grant.token}`, origin)).rejects.toMatchObject({
    status: 401,
  });
  const next = reopened.issue({ kind: 'agent', projectId: first.projectId });
  expect((await reopened.authorize(`Bearer ${next.token}`)).store.get(document.id)).toEqual(
    document,
  );
  const b = reopened.issue({ kind: 'agent', projectId: second.projectId });
  expect((await reopened.authorize(`Bearer ${b.token}`)).store.get(secondDocument.id)).toEqual(
    secondDocument,
  );
  expect(await readFile(join(directory, 'projects.json'), 'utf8')).not.toContain(grant.token);
  expect(
    await readFile(join(directory, 'projects', first.projectId, 'feedback.json'), 'utf8'),
  ).not.toContain(grant.token);
});

it('rejects conflicting roots and unknown project IDs instead of guessing a project', async () => {
  const { service, first, second } = await setup();
  expect(await service.register(first.root)).toEqual(first);
  await writeFile(
    join(second.root, 'ainotation.config.json'),
    JSON.stringify({ version: 1, name: 'Copied project', projectId: first.projectId }),
  );
  await expect(service.register(second.root)).rejects.toMatchObject({ status: 409 });
  expect(() => service.issue({ kind: 'agent', projectId: crypto.randomUUID() })).toThrow(
    'Project not registered',
  );
  expect(() =>
    service.issue({ kind: 'browser', projectId: first.projectId, origin: `${origin}/path` }),
  ).toThrow();
  expect(service.listProjects()).toHaveLength(2);
});
