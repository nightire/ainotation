import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  AnnotationContentSchema,
  feedbackExport,
  feedbackExportJsonSchema,
} from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createFeedbackStore, createMcpServer, type FeedbackStore } from './index';
import { fixture, origin } from './fixtures';

const connections: { client: Client; server: ReturnType<typeof createMcpServer> }[] = [];
afterEach(async () => {
  for (const { client, server } of connections.splice(0)) {
    await client.close();
    await server.close();
  }
});
async function connect(store?: FeedbackStore) {
  const server = createMcpServer(store);
  const client = new Client({ name: 'ainotation-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  connections.push({ client, server });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown>) => {
    const response = await client.callTool({ name, arguments: args });
    expect(response.isError).not.toBe(true);
    const content = response.content as { type: string; text: string }[];
    return JSON.parse(content[0]!.text) as unknown;
  };
  return { client, call };
}

it('serves annotation and image tools and the public schema over MCP without an HTTP port', async () => {
  const { client, call } = await connect();
  const tools = (await client.listTools()).tools;
  expect(tools.map((tool) => tool.name)).toEqual([
    'ainotation_get_schema',
    'ainotation_list_sessions',
    'ainotation_get_feedback',
    'ainotation_get_image',
    'ainotation_create_annotation',
    'ainotation_get_annotation',
    'ainotation_update_annotation',
    'ainotation_delete_annotation',
  ]);
  for (const tool of tools) {
    const readOnly = [
      'ainotation_get_schema',
      'ainotation_list_sessions',
      'ainotation_get_feedback',
      'ainotation_get_image',
      'ainotation_get_annotation',
    ].includes(tool.name);
    expect(tool.annotations?.readOnlyHint).toBe(readOnly);
    expect(tool.annotations?.openWorldHint).toBe(false);
    expect(tool.annotations?.destructiveHint).toBe(tool.name === 'ainotation_delete_annotation');
    if (!readOnly) expect(tool.annotations?.idempotentHint).toBe(true);
  }
  const schema = await call('ainotation_get_schema', {});
  expect(schema).toEqual(feedbackExportJsonSchema());
  expect(JSON.stringify(schema)).not.toMatch(/"(?:status|replies)"/);
});

it('projects all reads and mutation responses while retaining internal conversations', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const other = fixture(`${origin}/other`);
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.sync(other.id, { document: other, operations: [] }, origin);
  const pair = { sessionId: document.id, annotationId: document.annotations[0]!.id };
  const legacy = await store.action(document.id, pair.annotationId, {
    kind: 'resolve',
    summary: 'Internal conversation must stay private',
  });
  const { client, call } = await connect(store);
  expect(await call('ainotation_list_sessions', {})).toEqual([
    feedbackExport(legacy),
    feedbackExport(other),
  ]);
  expect(await call('ainotation_get_feedback', { sessionId: document.id })).toEqual(
    feedbackExport(legacy),
  );
  expect(await call('ainotation_get_annotation', pair)).toEqual(
    AnnotationContentSchema.parse(legacy.annotations[0]),
  );

  for (const name of ['get_pending', 'reply', 'acknowledge', 'resolve', 'dismiss']) {
    const response = await client.callTool({
      name: `ainotation_${name}`,
      arguments: { ...pair, message: 'Must not append', summary: 'Must not change' },
    });
    expect(response.isError).toBe(true);
    expect(JSON.stringify(response.content)).toMatch(/not found|unknown tool/i);
  }
  expect(store.get(document.id)).toEqual(legacy);

  const input = {
    ...pair,
    annotationId: randomUUID(),
    comment: 'New annotation',
    page: document.annotations[0]!.page,
    targets: document.annotations[0]!.targets,
  };
  expect(await call('ainotation_create_annotation', input)).toEqual(
    feedbackExport(store.get(document.id)),
  );
  expect(
    await call('ainotation_update_annotation', {
      ...pair,
      patch: { comment: 'Edited annotation' },
    }),
  ).toEqual(feedbackExport(store.get(document.id)));
  expect(
    await call('ainotation_delete_annotation', { ...pair, annotationId: input.annotationId }),
  ).toEqual(feedbackExport(store.get(document.id)));
  expect(store.get(document.id).annotations[0]).toMatchObject({
    comment: 'Edited annotation',
    status: 'resolved',
    replies: legacy.annotations[0]!.replies,
  });
  expect(store.get(other.id)).toEqual(other);
});

it('roundtrips CRUD through the real client with idempotent retries and tombstones', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const { call, client } = await connect(store);
  const source = document.annotations[0]!;
  const pair = { sessionId: document.id, annotationId: randomUUID() };
  const input = { ...pair, comment: 'Created by MCP', page: source.page, targets: source.targets };
  const created = await call('ainotation_create_annotation', input);
  expect(await call('ainotation_create_annotation', input)).toEqual(created);
  const annotation = store.get(document.id).annotations.at(-1)!;
  expect(annotation).toMatchObject({
    id: pair.annotationId,
    comment: input.comment,
    status: 'pending',
    replies: [],
  });
  expect(annotation.createdAt).toBe(annotation.updatedAt);
  expect(await call('ainotation_get_annotation', pair)).toEqual(
    AnnotationContentSchema.parse(annotation),
  );
  expect(changed).toHaveBeenCalledTimes(1);
  expect(
    (
      await client.callTool({
        name: 'ainotation_create_annotation',
        arguments: { ...input, comment: 'Conflicting retry' },
      })
    ).isError,
  ).toBe(true);

  const patch = {
    comment: 'Updated by MCP',
    page: { ...source.page, title: 'Updated page context' },
    targets: [{ ...source.targets[0]!, text: 'Updated target context' }],
  };
  const updated = await call('ainotation_update_annotation', { ...pair, patch });
  expect(updated).toEqual(feedbackExport(store.get(document.id)));
  expect(await call('ainotation_update_annotation', { ...pair, patch })).toEqual(updated);
  expect(await call('ainotation_get_annotation', pair)).toEqual({
    ...AnnotationContentSchema.parse(annotation),
    ...patch,
    updatedAt: store.get(document.id).annotations.at(-1)!.updatedAt,
  });
  expect(store.get(document.id).annotations.at(-1)!.updatedAt > annotation.updatedAt).toBe(true);
  expect(changed).toHaveBeenCalledTimes(2);

  const deleted = await call('ainotation_delete_annotation', pair);
  expect(deleted).toEqual(feedbackExport(document));
  expect(await call('ainotation_delete_annotation', pair)).toEqual(deleted);
  for (const [name, args] of [
    ['ainotation_get_annotation', pair],
    ['ainotation_update_annotation', { ...pair, patch }],
    ['ainotation_create_annotation', input],
    ['ainotation_delete_annotation', { ...pair, annotationId: randomUUID() }],
  ] as const) {
    expect((await client.callTool({ name, arguments: args })).isError).toBe(true);
  }
  await store.sync(
    document.id,
    {
      document,
      operations: [{ id: randomUUID(), kind: 'upsert', annotation }],
    },
    origin,
  );
  expect(await call('ainotation_get_feedback', { sessionId: document.id })).toEqual(deleted);
  expect(changed).toHaveBeenCalledTimes(3);
});

it('rejects hidden fields, empty patches, invalid context and cross-session annotation IDs', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const other = fixture(`${origin}/other`);
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.sync(other.id, { document: other, operations: [] }, origin);
  const { client } = await connect(store);
  const annotation = document.annotations[0]!;
  const pair = { sessionId: document.id, annotationId: annotation.id };
  for (const patch of [
    {},
    { status: 'resolved' },
    { replies: [] },
    { comment: 'Edit', replies: [] },
    { comment: 'Edit', unknown: true },
    { id: randomUUID() },
    { createdAt: annotation.createdAt },
    { updatedAt: annotation.updatedAt },
    { comment: '   ' },
    { page: { ...annotation.page, url: other.url } },
    { targets: [] },
  ]) {
    expect(
      (
        await client.callTool({
          name: 'ainotation_update_annotation',
          arguments: { ...pair, patch },
        })
      ).isError,
    ).toBe(true);
  }
  const input = {
    ...pair,
    annotationId: randomUUID(),
    comment: annotation.comment,
    page: annotation.page,
    targets: annotation.targets,
  };
  for (const args of [
    { ...input, status: 'resolved' },
    { ...input, replies: [] },
    { ...input, createdAt: annotation.createdAt },
    { ...input, updatedAt: annotation.updatedAt },
    { ...input, annotationId: 'invalid' },
    { ...input, sessionId: randomUUID() },
    { ...input, page: other.annotations[0]!.page },
    { ...input, targets: [] },
    {
      annotationId: input.annotationId,
      comment: input.comment,
      page: input.page,
      targets: input.targets,
    },
  ]) {
    expect(
      (await client.callTool({ name: 'ainotation_create_annotation', arguments: args })).isError,
    ).toBe(true);
  }
  for (const name of [
    'ainotation_get_annotation',
    'ainotation_update_annotation',
    'ainotation_delete_annotation',
  ]) {
    const response = await client.callTool({
      name,
      arguments: {
        ...pair,
        annotationId: other.annotations[0]!.id,
        ...(name === 'ainotation_update_annotation'
          ? { patch: { comment: 'Cross-session edit' } }
          : {}),
      },
    });
    expect(response.isError).toBe(true);
    expect(response.content).toEqual([
      { type: 'text', text: JSON.stringify({ error: 'Annotation not found in session' }) },
    ]);
  }
  expect(store.get(document.id)).toEqual(document);
  expect(store.get(other.id)).toEqual(other);
});
