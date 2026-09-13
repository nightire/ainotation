import { mkdir, mkdtemp, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createProjectMcpServer } from './project-mcp';
import { declareProject } from './project';
import { startSharedService } from './shared-service';
import { serviceRequest } from './service-client';
import type { IssuedGrant, ProjectGrant } from './project-service';
import { fixture, origin } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
const parse = (result: Awaited<ReturnType<Client['callTool']>>) =>
  JSON.parse((result.content as { text: string }[])[0]!.text);

async function setup(names = ['Admin', 'Store', 'Outside'], registerSecond = true) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'ainotation-workspace-mcp-')));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, 'workspace');
  await mkdir(workspace);
  await writeFile(join(workspace, 'package.json'), '{}');
  const projects: Awaited<ReturnType<typeof declareProject>>[] = [];
  const paths = [
    join(workspace, 'apps', 'admin'),
    join(workspace, 'apps', 'store'),
    join(root, 'workspace-other', 'outside'),
  ];
  for (const [index, path] of paths.entries()) {
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'package.json'), '{}');
    projects.push(
      await declareProject(path, {
        name: names[index]!,
        id: ['company/admin', 'company/store', 'elsewhere/outside'][index]!,
      }),
    );
  }
  const service = await startSharedService({ directory: join(root, 'service') });
  cleanup.push(service.close);
  const documents = projects.map(() => fixture());
  const register = async (index: number) => {
    const project = projects[index]!;
    await serviceRequest(service.connection, '/control/projects', {
      method: 'POST',
      body: { directory: project.root, declaration: project.declaration },
    });
    const grant = (await serviceRequest(service.connection, '/control/grants', {
      method: 'POST',
      body: { projectId: project.config.projectId, kind: 'browser', origin },
    })) as IssuedGrant;
    const document = documents[index]!;
    document.annotations[0]!.comment = `Feedback in ${project.config.name}`;
    const response = await fetch(`${service.connection.url}/sessions/${document.id}/sync`, {
      method: 'POST',
      headers: {
        Origin: origin,
        Authorization: `Bearer ${grant.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ document, operations: [] }),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
  };
  await register(0);
  if (registerSecond) await register(1);
  await register(2);
  async function connect(options: { directory?: string; roots?: () => { uri: string }[] } = {}) {
    const bridge = createProjectMcpServer({
      cwd: workspace,
      ...(options.directory ? { directory: options.directory } : {}),
      getService: async () => service.connection,
    });
    cleanup.push(bridge.close);
    const client = new Client(
      { name: 'monorepo-agent', version: '1' },
      { capabilities: options.roots ? { roots: { listChanged: true } } : {} },
    );
    cleanup.push(() => client.close());
    if (options.roots)
      client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: options.roots!() }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    return { client, bridge };
  }
  const grants = async () =>
    (
      (await serviceRequest(service.connection, '/control/grants')) as { grants: ProjectGrant[] }
    ).grants.filter((grant) => grant.kind === 'agent');
  return { root, workspace, projects, documents, connect, register, grants };
}

it('discovers only workspace apps and accepts a name, stable plugin key or UUID for each call', async () => {
  const { workspace, projects, documents, connect, grants } = await setup();
  const { client } = await connect({ roots: () => [{ uri: pathToFileURL(workspace).href }] });
  const list = await client.callTool({ name: 'ainotation_list_projects', arguments: {} });
  expect(list.isError).not.toBe(true);
  expect(parse(list).projects.map((project: { name: string }) => project.name)).toEqual([
    'Admin',
    'Store',
  ]);
  expect(await grants()).toHaveLength(0);
  const ambiguous = await client.callTool({ name: 'ainotation_list_sessions', arguments: {} });
  expect(ambiguous.isError).toBe(true);
  expect(parse(ambiguous).projects).toEqual(parse(list).projects);
  for (const [project, index] of [
    ['Admin', 0],
    ['company/store', 1],
    [projects[0]!.config.projectId, 0],
  ] as const) {
    const result = await client.callTool({
      name: 'ainotation_list_sessions',
      arguments: { project },
    });
    expect(result.isError).not.toBe(true);
    expect(parse(result).map((session: { id: string }) => session.id)).toEqual([
      documents[index]!.id,
    ]);
  }
  for (const project of ['Outside', projects[2]!.config.projectId, 'not-a-project']) {
    const result = await client.callTool({
      name: 'ainotation_get_project',
      arguments: { project },
    });
    expect(result.isError).toBe(true);
    expect(parse(result).projects.map((item: { name: string }) => item.name)).toEqual([
      'Admin',
      'Store',
    ]);
    expect(JSON.stringify(result)).not.toContain(projects[2]!.root);
  }
  expect((await grants()).map((grant) => grant.projectId).sort()).toEqual(
    projects
      .slice(0, 2)
      .map((project) => project.config.projectId)
      .sort(),
  );
});

it('keeps concurrent CRUD calls on different projects independent and never infers project from a foreign session ID', async () => {
  const { projects, documents, connect } = await setup();
  const { client } = await connect();
  const added = await Promise.all(
    ['Admin', 'Store'].map(async (project, index) => {
      const document = documents[index]!;
      const original = document.annotations[0]!;
      const annotationId = crypto.randomUUID();
      const result = await client.callTool({
        name: 'ainotation_create_annotation',
        arguments: {
          project,
          sessionId: document.id,
          annotationId,
          comment: `New ${project}`,
          page: original.page,
          targets: original.targets,
        },
      });
      expect(result.isError).not.toBe(true);
      return { project, sessionId: document.id, annotationId };
    }),
  );
  const changed = await Promise.all(
    added.map((pair) =>
      client.callTool({
        name: 'ainotation_update_annotation',
        arguments: { ...pair, patch: { comment: `Edited ${pair.project}` } },
      }),
    ),
  );
  expect(changed.every((result) => !result.isError)).toBe(true);
  const reads = await Promise.all(
    added.map((pair) => client.callTool({ name: 'ainotation_get_annotation', arguments: pair })),
  );
  expect(reads.map((result) => parse(result).comment)).toEqual(['Edited Admin', 'Edited Store']);
  const wrong = await client.callTool({
    name: 'ainotation_get_feedback',
    arguments: { project: 'Admin', sessionId: documents[1]!.id },
  });
  expect(wrong.isError).toBe(true);
  const missing = await client.callTool({
    name: 'ainotation_get_feedback',
    arguments: { sessionId: documents[1]!.id },
  });
  expect(missing.isError).toBe(true);
  expect(parse(missing).projects).toHaveLength(2);
  const removed = await Promise.all(
    added.map((pair) => client.callTool({ name: 'ainotation_delete_annotation', arguments: pair })),
  );
  expect(removed.every((result) => !result.isError)).toBe(true);
  for (const [index, project] of projects.slice(0, 2).entries()) {
    const result = await client.callTool({
      name: 'ainotation_get_feedback',
      arguments: { project: project.config.projectId, sessionId: documents[index]!.id },
    });
    expect(parse(result).annotations).toHaveLength(1);
  }
});

it('requires UUIDs for duplicate display names while an explicit app directory stays fixed', async () => {
  const { projects, documents, connect } = await setup(['Shared name', 'Shared name', 'Outside']);
  const { client } = await connect();
  const duplicate = await client.callTool({
    name: 'ainotation_get_project',
    arguments: { project: 'Shared name' },
  });
  expect(duplicate.isError).toBe(true);
  expect(parse(duplicate).projects).toHaveLength(2);
  expect(
    parse(
      await client.callTool({
        name: 'ainotation_get_project',
        arguments: { project: projects[1]!.config.projectId },
      }),
    ).projectId,
  ).toBe(projects[1]!.config.projectId);
  const fixed = await connect({ directory: projects[0]!.root });
  expect(
    parse(await fixed.client.callTool({ name: 'ainotation_list_projects', arguments: {} }))
      .projects,
  ).toHaveLength(1);
  expect(
    parse(await fixed.client.callTool({ name: 'ainotation_list_sessions', arguments: {} }))[0].id,
  ).toBe(documents[0]!.id);
  expect(
    (
      await fixed.client.callTool({
        name: 'ainotation_list_sessions',
        arguments: { project: projects[1]!.config.projectId },
      })
    ).isError,
  ).toBe(true);
});

it('requires an explicit project after a second app registers rather than retaining a last-used project', async () => {
  const { register, connect, documents } = await setup(undefined, false);
  const { client } = await connect();
  expect(
    parse(await client.callTool({ name: 'ainotation_list_sessions', arguments: {} }))[0].id,
  ).toBe(documents[0]!.id);
  await register(1);
  const result = await client.callTool({ name: 'ainotation_list_sessions', arguments: {} });
  expect(result.isError).toBe(true);
  expect(parse(result).projects).toHaveLength(2);
});

it('supports multiple roots and revokes all project connections when workspace roots change', async () => {
  const { projects, connect, grants } = await setup();
  let roots = projects.slice(0, 2).map((project) => ({ uri: pathToFileURL(project.root).href }));
  const { client } = await connect({ roots: () => roots });
  await Promise.all(
    ['Admin', 'Store'].map((project) =>
      client.callTool({ name: 'ainotation_get_project', arguments: { project } }),
    ),
  );
  expect(await grants()).toHaveLength(2);
  roots = [{ uri: pathToFileURL(projects[2]!.root).href }];
  await client.notification({ method: 'notifications/roots/list_changed' });
  await vi.waitFor(async () => expect(await grants()).toHaveLength(0));
  expect((await client.callTool({ name: 'ainotation_list_projects', arguments: {} })).isError).toBe(
    true,
  );
});

it('does not follow a registered app directory replaced by a symlink outside the workspace', async () => {
  const { projects, connect, grants } = await setup();
  const { client } = await connect();
  await client.callTool({ name: 'ainotation_get_project', arguments: { project: 'Admin' } });
  await rename(projects[0]!.root, `${projects[0]!.root}-previous`);
  await symlink(projects[2]!.root, projects[0]!.root, 'dir');
  const result = await client.callTool({
    name: 'ainotation_get_project',
    arguments: { project: 'Admin' },
  });
  expect(result.isError).toBe(true);
  expect(parse(result).projects.map((project: { name: string }) => project.name)).toEqual([
    'Store',
  ]);
  expect(await grants()).toHaveLength(0);
});

it('lets two Agent sessions choose opposite projects concurrently without sharing selection state', async () => {
  const { connect, documents, grants } = await setup();
  const a = await connect();
  const b = await connect();
  const calls = [
    [a.client, 'Admin', 0],
    [a.client, 'Store', 1],
    [b.client, 'Store', 1],
    [b.client, 'Admin', 0],
  ] as const;
  await Promise.all(
    calls.map(async ([client, project, index]) => {
      const result = await client.callTool({
        name: 'ainotation_list_sessions',
        arguments: { project },
      });
      expect(result.isError).not.toBe(true);
      expect(parse(result).map((session: { id: string }) => session.id)).toEqual([
        documents[index]!.id,
      ]);
    }),
  );
  expect(await grants()).toHaveLength(4);
  await a.client.close();
  await vi.waitFor(async () => expect(await grants()).toHaveLength(2));
  expect(
    (await b.client.callTool({ name: 'ainotation_list_sessions', arguments: { project: 'Admin' } }))
      .isError,
  ).not.toBe(true);
});
