import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { expect, it } from 'vite-plus/test';
import { feedbackMarkdown } from '@ainotation/schema';
import { createFeedbackStore, createMcpServer } from './index';
import { fixture, origin } from './fixtures';

it.each(['same-session', 'other-session', 'same-batch'] as const)(
  'acknowledges a deleted annotation’s delayed start while %s owns another exploration',
  async (scope) => {
    const store = await createFeedbackStore();
    const original = fixture(),
      deleted = original.annotations[0]!;
    await store.sync(original.id, { document: original, operations: [] }, origin);
    const remove = { id: crypto.randomUUID(), kind: 'delete' as const, annotationId: deleted.id };
    if (scope !== 'same-batch')
      await store.sync(original.id, { document: original, operations: [remove] }, origin);
    const other = fixture(original.url),
      owner = other.annotations[0]!;
    const start = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: owner,
      variantRequest: crypto.randomUUID(),
    };
    const ownerSession = scope === 'other-session' ? other.id : original.id;
    if (scope !== 'same-batch')
      await store.sync(
        ownerSession,
        {
          document: scope === 'other-session' ? other : store.get(original.id),
          operations: [start],
        },
        origin,
      );
    const late = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: deleted,
      variantRequest: crypto.randomUUID(),
    };
    const following = {
      id: crypto.randomUUID(),
      kind: 'upsert' as const,
      annotation: {
        ...deleted,
        id: crypto.randomUUID(),
        comment: 'A queued edit must still be saved',
      },
    };
    const operations = [...(scope === 'same-batch' ? [remove, start] : []), late, following];
    const response = await store.sync(original.id, { document: original, operations }, origin);
    expect(response.acknowledged).toEqual(operations.map((operation) => operation.id));
    expect(response.document.annotations.some((annotation) => annotation.id === deleted.id)).toBe(
      false,
    );
    expect(
      response.document.annotations.find((annotation) => annotation.id === following.annotation.id)
        ?.comment,
    ).toBe(following.annotation.comment);
    expect(
      store.get(ownerSession).annotations.find((annotation) => annotation.id === owner.id)?.variants
        ?.id,
    ).toBe(start.variantRequest);
    const retry = await store.sync(original.id, { document: original, operations }, origin);
    expect(retry.document).toEqual(response.document);
    expect(retry.acknowledged).toEqual(response.acknowledged);
  },
);

it.each(['browser', 'mcp'] as const)(
  'retains cleanup after %s deletion until the agent completes it',
  async (source) => {
    const directory = await mkdtemp(join(tmpdir(), 'ainotation-cleanup-'));
    const filePath = join(directory, 'feedback.json');
    const store = await createFeedbackStore({ filePath });
    const document = fixture(),
      note = document.annotations[0]!;
    await store.sync(
      document.id,
      {
        document,
        operations: [
          {
            id: crypto.randomUUID(),
            kind: 'upsert',
            annotation: note,
            variantRequest: crypto.randomUUID(),
          },
        ],
      },
      origin,
    );
    const initial = store.get(document.id).annotations[0]!.variants!;
    const publish = {
      id: crypto.randomUUID(),
      kind: 'variants' as const,
      annotationId: note.id,
      explorationId: initial.id,
      generation: initial.generation,
      revision: initial.revision,
      action: { type: 'publish' as const, choices: [{ id: 'compact', label: 'Compact' }] },
    };
    await store.variants(document.id, publish);
    const before = store.get(document.id).annotations[0]!;
    const server = createMcpServer(store),
      client = new Client({ name: 'cleanup-agent', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(st);
      await client.connect(ct);
      if (source === 'browser') {
        const operation = {
          id: crypto.randomUUID(),
          kind: 'delete' as const,
          annotationId: note.id,
        };
        await store.sync(
          document.id,
          { document: store.get(document.id), operations: [operation] },
          origin,
        );
        await store.sync(
          document.id,
          { document: store.get(document.id), operations: [operation] },
          origin,
        );
      } else {
        expect(
          (
            await client.callTool({
              name: 'ainotation_delete_annotation',
              arguments: {
                sessionId: document.id,
                annotationId: note.id,
              },
            })
          ).isError,
        ).not.toBe(true);
        await store.deleteAnnotation(document.id, note.id);
      }
      const deleted = store.get(document.id),
        cleanup = deleted.variantCleanups![0]!;
      expect(deleted.annotations).toEqual([]);
      expect(deleted.variantCleanups).toHaveLength(1);
      expect(cleanup).toMatchObject({
        id: note.id,
        reason: 'annotation-deleted',
        comment: note.comment,
        page: note.page,
        targets: note.targets,
      });
      expect(cleanup.variants).toMatchObject({
        id: initial.id,
        status: 'cancelled',
        revision: before.variants!.revision + 1,
        manifest: before.variants!.manifest,
        decision: { kind: 'cancel' },
      });
      expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(deleted);
      const result = await client.callTool({
        name: 'ainotation_get_variants',
        arguments: { sessionId: document.id, annotationId: note.id },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain('annotation-deleted');
      expect(
        JSON.stringify(
          (await client.callTool({ name: 'ainotation_list_sessions', arguments: {} })).content,
        ),
      ).toContain('restore Original');
      for (const detail of ['compact', 'standard', 'detailed', 'forensic'] as const)
        expect(feedbackMarkdown(deleted, { detail })).toContain('Pending UI Variants cleanup');
      await expect(
        store.variants(document.id, { ...publish, id: crypto.randomUUID() }),
      ).rejects.toMatchObject({ status: 409 });

      // Browser recovery cannot erase the pending task or resurrect the annotation.
      const conflict = await store.sync(
        document.id,
        { document, operations: [], storageEpoch: crypto.randomUUID() },
        origin,
      );
      await store.sync(
        document.id,
        {
          document,
          operations: [],
          recovery: {
            epoch: conflict.storageEpoch!,
            revision: conflict.recovery!.revision,
            source: 'browser',
          },
        },
        origin,
      );
      expect(store.get(document.id).variantCleanups).toEqual(deleted.variantCleanups);
      expect(store.get(document.id).annotations).toEqual([]);

      const other = fixture(document.url);
      const request = {
        id: crypto.randomUUID(),
        kind: 'upsert' as const,
        annotation: other.annotations[0]!,
        variantRequest: crypto.randomUUID(),
      };
      const blocked = await store.sync(
        other.id,
        { document: other, operations: [request] },
        origin,
      );
      expect(blocked.variantConflicts).toEqual([request.id]);
      const args = {
        sessionId: document.id,
        annotationId: note.id,
        explorationId: cleanup.variants.id,
        generation: cleanup.variants.generation,
        revision: cleanup.variants.revision,
        operationId: crypto.randomUUID(),
        decisionId: cleanup.variants.decision!.id,
        summary:
          'Restored Original, removed generated variants and integration, verified the build.',
      };
      expect(
        (
          await client.callTool({
            name: 'ainotation_complete_variants',
            arguments: { ...args, decisionId: crypto.randomUUID() },
          })
        ).isError,
      ).toBe(true);
      for (let retry = 0; retry < 2; retry++)
        expect(
          (await client.callTool({ name: 'ainotation_complete_variants', arguments: args }))
            .isError,
        ).not.toBe(true);
      expect(store.get(document.id).annotations).toEqual([]);
      expect(store.get(document.id).variantCleanups![0]!.variants.status).toBe('completed');
      const completedRead = await client.callTool({
        name: 'ainotation_get_variants',
        arguments: { sessionId: document.id, annotationId: note.id },
      });
      expect(JSON.stringify(completedRead.content)).toContain('No further source changes');
      expect(JSON.stringify(completedRead.content)).not.toContain(
        'Annotation deleted: restore Original',
      );
      const oldRecovery = await store.sync(
        document.id,
        { document: deleted, operations: [], storageEpoch: crypto.randomUUID() },
        origin,
      );
      await store.sync(
        document.id,
        {
          document: deleted,
          operations: [],
          recovery: {
            epoch: oldRecovery.storageEpoch!,
            revision: oldRecovery.recovery!.revision,
            source: 'browser',
          },
        },
        origin,
      );
      expect(store.get(document.id).variantCleanups![0]!.variants.status).toBe('completed');
      expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(
        store.get(document.id),
      );
      expect(
        (
          await store.sync(
            other.id,
            {
              document: store.get(other.id),
              operations: [{ ...request, id: crypto.randomUUID() }],
            },
            origin,
          )
        ).variantConflicts ?? [],
      ).toEqual([]);
      expect(store.get(other.id).annotations[0]!.variants?.status).toBe('requested');
    } finally {
      await client.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
