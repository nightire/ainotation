import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ListRootsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createProjectMcpServer } from './project-mcp';
import { initializeProject } from './project';
import { declareProject } from './project';
import { startSharedService } from './shared-service';
import { ensureSharedService } from './service-discovery';
import { serviceRequest } from './service-client';
import type { ProjectGrant, IssuedGrant } from './project-service';
import { fixture, origin } from './fixtures';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(leaseMs = 5 * 60 * 1000) {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-project-mcp-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const projects = [];
  for (const name of ['a', 'b']) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name }));
    projects.push(await initializeProject({ directory }));
  }
  let service = await startSharedService({ directory: join(root, 'service'), leaseMs });
  cleanup.push(service.close);
  const documents = [fixture(), fixture()];
  documents[1]!.annotations[0]!.comment = 'Only project B';
  for (let i = 0; i < 2; i++) {
    const project = projects[i]!;
    await serviceRequest(service.connection, '/control/projects', {
      method: 'POST',
      body: { directory: project.root },
    });
    const grant = (await serviceRequest(service.connection, '/control/grants', {
      method: 'POST',
      body: { kind: 'browser', projectId: project.config.projectId, origin },
    })) as IssuedGrant;
    const document = documents[i]!;
    const response = await fetch(`${service.connection.url}/sessions/${document.id}/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Authorization: `Bearer ${grant.token}`,
      },
      body: JSON.stringify({ document, operations: [] }),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
  }
  const grants = async () =>
    (
      (await serviceRequest(service.connection, '/control/grants')) as { grants: ProjectGrant[] }
    ).grants.filter((grant) => grant.kind === 'agent');
  async function connect(
    options: { directory?: string; roots?: () => { uri: string }[]; cwd?: string } = {},
  ) {
    const bridge = createProjectMcpServer({
      ...(options.directory ? { directory: options.directory } : {}),
      cwd: options.cwd ?? root,
      getService: (signal) => ensureSharedService({ directory: service.directory, signal }),
    });
    cleanup.push(bridge.close);
    const client = new Client(
      { name: 'project-scope-test', version: '1' },
      { capabilities: options.roots ? { roots: { listChanged: true } } : {} },
    );
    if (options.roots)
      client.setRequestHandler(ListRootsRequestSchema, () => ({ roots: options.roots!() }));
    cleanup.push(() => client.close());
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(serverTransport);
    await client.connect(clientTransport);
    return { client, bridge };
  }
  return {
    projects,
    documents,
    connect,
    grants,
    revoke: async (id: string) =>
      serviceRequest(service.connection, `/control/grants/${id}`, { method: 'DELETE' }),
    restart: async () => {
      await service.close();
      service = await startSharedService({ directory: service.directory, leaseMs });
      cleanup.push(service.close);
    },
  };
}
function payload(result: Awaited<ReturnType<Client['callTool']>>) {
  const content = result.content as { type: string; text: string }[];
  return JSON.parse(content[0]!.text);
}

it('can connect before the first dev startup and bind after plugin registration without a config file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-no-config-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'web');
  await mkdir(app);
  await writeFile(join(app, 'package.json'), '{}');
  const shared = await startSharedService({ directory: join(root, 'service') });
  cleanup.push(shared.close);
  const bridge = createProjectMcpServer({
    directory: app,
    getService: async () => shared.connection,
  });
  cleanup.push(bridge.close);
  const client = new Client({ name: 'early-agent', version: '1' });
  cleanup.push(() => client.close());
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await bridge.server.connect(st);
  await client.connect(ct);
  const early = await client.callTool({ name: 'ainotation_get_project', arguments: {} });
  expect(early.isError).toBe(true);
  expect(payload(early).error).toContain('Start the Web app');
  const project = await declareProject(app, { name: 'Web app', id: 'company/web' });
  await serviceRequest(shared.connection, '/control/projects', {
    method: 'POST',
    body: { directory: app, declaration: project.declaration },
  });
  const bound = await client.callTool({ name: 'ainotation_get_project', arguments: {} });
  expect(bound.isError).not.toBe(true);
  expect(payload(bound)).toMatchObject({ projectId: project.config.projectId, name: 'Web app' });
  await serviceRequest(shared.connection, '/control/projects', {
    method: 'POST',
    body: { directory: app, declaration: { name: 'Renamed Web App', id: 'company/web' } },
  });
  expect(
    payload(await client.callTool({ name: 'ainotation_get_project', arguments: {} })),
  ).toMatchObject({ projectId: project.config.projectId, name: 'Renamed Web App' });
});

it('keeps two MCP connections scoped to their projects and revokes one without affecting the other', async () => {
  const { projects, documents, connect, grants } = await setup();
  const a = await connect({ directory: projects[0]!.root });
  const b = await connect({ directory: projects[1]!.root });
  const infos = await Promise.all(
    [a.client, b.client].map((client) =>
      client.callTool({ name: 'ainotation_get_project', arguments: {} }),
    ),
  );
  expect(infos.map((info) => payload(info).projectId)).toEqual(
    projects.map((project) => project.config.projectId),
  );
  const sessions = await Promise.all(
    [a.client, b.client].map((client) =>
      client.callTool({ name: 'ainotation_list_sessions', arguments: {} }),
    ),
  );
  expect(
    sessions.map((result) => payload(result).map((document: { id: string }) => document.id)),
  ).toEqual(documents.map((document) => [document.id]));
  const foreign = { sessionId: documents[1]!.id, annotationId: documents[1]!.annotations[0]!.id };
  for (const name of ['ainotation_get_annotation', 'ainotation_delete_annotation'])
    expect((await a.client.callTool({ name, arguments: foreign })).isError).toBe(true);
  expect(
    (
      await a.client.callTool({
        name: 'ainotation_update_annotation',
        arguments: { ...foreign, patch: { comment: 'Cross-project change' } },
      })
    ).isError,
  ).toBe(true);
  const own = {
    sessionId: documents[0]!.id,
    annotationId: crypto.randomUUID(),
    comment: 'Created through MCP bridge',
    page: documents[0]!.annotations[0]!.page,
    targets: documents[0]!.annotations[0]!.targets,
  };
  expect(
    (await a.client.callTool({ name: 'ainotation_create_annotation', arguments: own })).isError,
  ).not.toBe(true);
  expect(
    (
      await a.client.callTool({
        name: 'ainotation_update_annotation',
        arguments: {
          sessionId: own.sessionId,
          annotationId: own.annotationId,
          patch: { comment: 'Updated through MCP bridge' },
        },
      })
    ).isError,
  ).not.toBe(true);
  expect(
    payload(
      await a.client.callTool({
        name: 'ainotation_get_annotation',
        arguments: { sessionId: own.sessionId, annotationId: own.annotationId },
      }),
    ).comment,
  ).toBe('Updated through MCP bridge');
  expect(await grants()).toHaveLength(2);
  await a.client.close();
  await vi.waitFor(async () => expect(await grants()).toHaveLength(1));
  expect((await grants())[0]!.projectId).toBe(projects[1]!.config.projectId);
  expect(
    (await b.client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError,
  ).not.toBe(true);
});

it('uses Agent roots for global configuration and fails closed for ambiguous or changed workspaces', async () => {
  const { projects, connect, grants } = await setup();
  let roots = [{ uri: pathToFileURL(projects[0]!.root).href }];
  const { client } = await connect({ roots: () => roots });
  expect(
    payload(await client.callTool({ name: 'ainotation_get_project', arguments: {} })).projectId,
  ).toBe(projects[0]!.config.projectId);
  roots = projects.map((project) => ({ uri: pathToFileURL(project.root).href }));
  expect((await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError).toBe(
    true,
  );
  await client.notification({ method: 'notifications/roots/list_changed' });
  await vi.waitFor(async () => expect(await grants()).toHaveLength(0));
  expect((await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError).toBe(
    true,
  );
  const ambiguous = await connect({ roots: () => roots });
  expect(
    (await ambiguous.client.callTool({ name: 'ainotation_get_project', arguments: {} })).isError,
  ).toBe(true);
  expect(await grants()).toHaveLength(0);
  const fallback = await connect({ cwd: projects[1]!.root });
  expect(
    payload(await fallback.client.callTool({ name: 'ainotation_get_project', arguments: {} }))
      .projectId,
  ).toBe(projects[1]!.config.projectId);
});

it('renews its lease and does not silently reacquire explicitly revoked authorization', async () => {
  const { projects, connect, grants, revoke } = await setup(1200);
  const { client } = await connect({ directory: projects[0]!.root });
  expect(
    (await client.callTool({ name: 'ainotation_get_project', arguments: {} })).isError,
  ).not.toBe(true);
  const initial = (await grants())[0]!;
  await vi.waitFor(
    async () => expect((await grants())[0]!.expiresAt).toBeGreaterThan(initial.expiresAt),
    { timeout: 2500 },
  );
  expect((await grants())[0]!.grantId).toBe(initial.grantId);
  await revoke(initial.grantId);
  expect((await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError).toBe(
    true,
  );
  expect((await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError).toBe(
    true,
  );
  expect(await grants()).toHaveLength(0);
});

it('reconnects the same bound project after shared-service restart on the next explicit retry', async () => {
  const { projects, connect, documents, restart } = await setup();
  const { client } = await connect({ directory: projects[0]!.root });
  expect(
    (await client.callTool({ name: 'ainotation_get_project', arguments: {} })).isError,
  ).not.toBe(true);
  await restart();
  expect((await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).isError).toBe(
    true,
  );
  const retry = await client.callTool({ name: 'ainotation_list_sessions', arguments: {} });
  expect(retry.isError).not.toBe(true);
  expect(payload(retry).map((document: { id: string }) => document.id)).toEqual([documents[0]!.id]);
});
