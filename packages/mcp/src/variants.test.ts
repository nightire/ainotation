import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  applyFeedbackOperation,
  type VariantAction,
  type VariantOperation,
} from '@ainotation/schema';
import { createFeedbackStore, createMcpServer } from './index';
import { fixture, origin } from './fixtures';

it('persists the full MCP/browser exploration cycle, preserves intent on edits and rejects stale writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ainotation-variants-'));
  const filePath = join(directory, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const base = fixture();
  const note = base.annotations[0]!;
  const request = {
    id: crypto.randomUUID(),
    kind: 'upsert' as const,
    annotation: note,
    variantRequest: crypto.randomUUID(),
  };
  await store.sync(
    base.id,
    { document: applyFeedbackOperation(base, request), operations: [request] },
    origin,
  );
  const server = createMcpServer(store);
  const client = new Client({ name: 'variants-test', version: '1' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(st);
    await client.connect(ct);
    expect(
      (await client.listResources()).resources.some(
        (resource) => resource.uri === 'ainotation://guides/ui-variants/v1',
      ),
    ).toBe(true);
    expect(
      JSON.stringify(await client.readResource({ uri: 'ainotation://guides/ui-variants/v1' })),
    ).toContain('virtual:ainotation/variants');
    const current = () => store.get(base.id).annotations[0]!.variants!;
    const args = () => ({
      sessionId: base.id,
      annotationId: note.id,
      explorationId: current().id,
      generation: current().generation,
      revision: current().revision,
    });
    const publish = {
      ...args(),
      operationId: crypto.randomUUID(),
      choices: [
        { id: 'compact', label: 'Compact' },
        { id: 'bold', label: 'Bold' },
      ],
    };
    expect(
      (await client.callTool({ name: 'ainotation_publish_variants', arguments: publish })).isError,
    ).not.toBe(true);
    expect(
      (await client.callTool({ name: 'ainotation_publish_variants', arguments: publish })).isError,
    ).not.toBe(true);
    expect(current()).toMatchObject({ revision: 2, status: 'published' });
    expect(
      (
        await client.callTool({
          name: 'ainotation_publish_variants',
          arguments: {
            ...publish,
            choices: [{ id: 'other', label: 'Different operation content' }],
          },
        })
      ).isError,
    ).toBe(true);
    const read = await client.callTool({
      name: 'ainotation_get_annotation',
      arguments: { sessionId: base.id, annotationId: note.id },
    });
    expect(JSON.stringify(read)).toContain('ainotation_get_variants_guide');
    const edit = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: { ...note, comment: 'Updated human feedback' },
    };
    await store.sync(base.id, { document: store.get(base.id), operations: [edit] }, origin);
    expect(current().status).toBe('published');
    const browser = async (action: VariantAction) => {
      const { sessionId: _, ...scope } = args();
      const operation: VariantOperation = {
        ...scope,
        id: crypto.randomUUID(),
        kind: 'variants',
        action,
      };
      await store.sync(base.id, { document: store.get(base.id), operations: [operation] }, origin);
      return operation;
    };
    const chosen = await browser({ type: 'accept', variantId: 'bold', feedback: 'Keep this one' });
    const wrong = await client.callTool({
      name: 'ainotation_complete_variants',
      arguments: {
        ...args(),
        operationId: crypto.randomUUID(),
        decisionId: crypto.randomUUID(),
        summary: 'Wrong decision',
      },
    });
    expect(wrong.isError).toBe(true);
    const regenerated = await browser({ type: 'regenerate', feedback: 'Try different corners' });
    expect(current()).toMatchObject({
      generation: 2,
      status: 'requested',
      manifest: { generation: 1 },
    });
    const stale = await store.sync(
      base.id,
      { document: store.get(base.id), operations: [{ ...chosen, id: crypto.randomUUID() }] },
      origin,
    );
    expect(stale.variantConflicts).toHaveLength(1);
    expect(current().decision?.id).toBe(regenerated.id);
    await browser({ type: 'cancel', feedback: '' });
    const finish = await client.callTool({
      name: 'ainotation_complete_variants',
      arguments: {
        ...args(),
        operationId: crypto.randomUUID(),
        decisionId: current().decision!.id,
        summary: 'Restored original and removed temporary integration.',
      },
    });
    expect(finish.isError).not.toBe(true);
    const reopened = await createFeedbackStore({ filePath });
    expect(reopened.get(base.id).annotations[0]).toMatchObject({
      comment: 'Updated human feedback',
      variants: { status: 'completed', decision: { kind: 'cancel' } },
    });
    expect(reopened.get(base.id).annotations[0]!.targets).toEqual(note.targets);
    const completed = store.get(base.id).annotations[0]!;
    await store.sync(
      base.id,
      {
        document: store.get(base.id),
        operations: [
          {
            ...edit,
            id: crypto.randomUUID(),
            annotation: { ...completed, comment: 'Ordinary edit after cleanup' },
          },
        ],
      },
      origin,
    );
    expect(current()).toEqual(completed.variants);
    const restart = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: { ...completed, comment: 'Try another exploration' },
      variantRequest: crypto.randomUUID(),
    };
    // Another session can own this URL while this annotation is completed.
    const other = fixture(base.url);
    const otherStart = {
      ...request,
      id: crypto.randomUUID(),
      annotation: other.annotations[0]!,
      variantRequest: crypto.randomUUID(),
    };
    await store.sync(other.id, { document: other, operations: [otherStart] }, origin);
    const busy = await store.sync(
      base.id,
      { document: store.get(base.id), operations: [restart] },
      origin,
    );
    expect(busy.variantConflicts).toEqual([restart.id]);
    expect(current()).toEqual(completed.variants);
    await store.sync(
      other.id,
      {
        document: store.get(other.id),
        operations: [
          {
            id: crypto.randomUUID(),
            kind: 'delete',
            annotationId: other.annotations[0]!.id,
          },
        ],
      },
      origin,
    );
    const otherCleanup = store.get(other.id).variantCleanups![0]!;
    await store.variants(other.id, {
      id: crypto.randomUUID(),
      kind: 'variants',
      annotationId: otherCleanup.id,
      explorationId: otherCleanup.variants.id,
      generation: otherCleanup.variants.generation,
      revision: otherCleanup.variants.revision,
      action: {
        type: 'complete',
        decisionId: otherCleanup.variants.decision!.id,
        summary: 'Restored Original and cleaned up after deletion.',
      },
    });
    restart.id = crypto.randomUUID();
    await store.sync(base.id, { document: store.get(base.id), operations: [restart] }, origin);
    expect(current()).toMatchObject({
      id: restart.variantRequest,
      status: 'requested',
      generation: 1,
      revision: 1,
    });
    expect(current().decision).toBeUndefined();
    expect(current().completion).toBeUndefined();
    expect(current().manifest).toBeUndefined();
    expect(current().report).toBeUndefined();
    expect(store.get(base.id).annotations).toHaveLength(1);
    expect(store.get(base.id).annotations[0]!.targets).toEqual(note.targets);
    const raced = { ...restart, id: crypto.randomUUID(), variantRequest: crypto.randomUUID() };
    const conflict = await store.sync(
      base.id,
      { document: store.get(base.id), operations: [raced, { ...chosen, id: crypto.randomUUID() }] },
      origin,
    );
    expect(conflict.variantConflicts).toHaveLength(2);
    expect(current().id).toBe(restart.variantRequest);
    expect(current().status).toBe('requested');
    expect((await createFeedbackStore({ filePath })).get(base.id).annotations[0]!.variants).toEqual(
      current(),
    );
  } finally {
    await client.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});

it('serializes ownership across browser sessions for the same full URL and isolates other pages', async () => {
  const store = await createFeedbackStore();
  const first = fixture(),
    second = fixture(first.url),
    other = fixture(`${origin}/another`);
  const start = (document: typeof first) => {
    const operation = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: document.annotations[0]!,
      variantRequest: crypto.randomUUID(),
    };
    return store.sync(
      document.id,
      { document: applyFeedbackOperation(document, operation), operations: [operation] },
      origin,
    );
  };
  const results = await Promise.all([start(first), start(second), start(other)]);
  expect(results[0]!.document.annotations[0]!.variants?.status).toBe('requested');
  expect(results[1]!.variantConflicts).toHaveLength(1);
  expect(results[1]!.document.annotations[0]!.variants).toBeUndefined();
  expect(results[2]!.document.annotations[0]!.variants?.status).toBe('requested');
  const state = store.get(first.id).annotations[0]!.variants!;
  await expect(
    store.sync(
      first.id,
      {
        document: store.get(first.id),
        operations: [
          {
            id: crypto.randomUUID(),
            kind: 'variants',
            annotationId: first.annotations[0]!.id,
            explorationId: state.id,
            revision: state.revision,
            generation: state.generation,
            action: { type: 'publish', choices: [{ id: 'a', label: 'A' }] },
          },
        ],
      },
      origin,
    ),
  ).rejects.toMatchObject({ status: 403 });
});
