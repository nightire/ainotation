import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type FeedbackOperation } from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createFeedbackStore, type AnnotationPatch, type CreateAnnotationInput } from './store';
import { fixture, origin } from './fixtures';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
async function temporary() {
  const directory = await mkdtemp(join(tmpdir(), 'ainotation-mcp-'));
  directories.push(directory);
  return directory;
}

it('ignores stale snapshots, deduplicates lost-response retries, and emits only effective changes', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  const changed = vi.fn();
  const unsubscribe = store.subscribe(document.id, changed);
  const operation: FeedbackOperation = {
    id: randomUUID(),
    kind: 'reply',
    annotationId: annotation.id,
    reply: {
      id: randomUUID(),
      role: 'human',
      message: 'More context',
      createdAt: document.createdAt,
    },
  };
  const response = await store.sync(document.id, { document, operations: [operation] }, origin);
  const retry = await store.sync(document.id, { document, operations: [operation] }, origin);
  expect(retry).toEqual(response);
  expect(retry.acknowledged).toEqual([operation.id]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(retry.document.annotations[0]!.replies).toHaveLength(1);
  await store.sync(document.id, { document, operations: [] }, origin);
  const current = store.get(document.id).annotations[0]!;
  await store.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'upsert', annotation: current }] },
    origin,
  );
  expect(changed).toHaveBeenCalledTimes(1);
  unsubscribe();
  await store.action(document.id, annotation.id, { kind: 'reply', message: 'Agent follow-up' });
  expect(changed).toHaveBeenCalledTimes(1);
});

it('does not treat reordered attribute/style keys as annotation changes', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  annotation.targets[0]!.attributes = { id: 'target', role: 'button' };
  annotation.targets[0]!.styles = { color: 'red', display: 'block' };
  await store.sync(document.id, { document, operations: [] }, origin);
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const reordered = structuredClone(annotation);
  reordered.targets[0]!.attributes = { role: 'button', id: 'target' };
  reordered.targets[0]!.styles = { display: 'block', color: 'red' };
  const operation: FeedbackOperation = { id: randomUUID(), kind: 'upsert', annotation: reordered };
  const result = await store.sync(document.id, { document, operations: [operation] }, origin);
  expect(result.acknowledged).toEqual([operation.id]);
  expect(result.document.annotations[0]!.updatedAt).toBe(annotation.updatedAt);
  expect(changed).not.toHaveBeenCalled();
});

it('keeps agent status/replies during upsert, updates timestamps, and prevents tombstone resurrection', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  const resolved = await store.action(document.id, annotation.id, {
    kind: 'resolve',
    summary: 'Fixed spacing',
  });
  expect(resolved.annotations[0]!.updatedAt > annotation.updatedAt).toBe(true);
  const edited = await store.sync(
    document.id,
    {
      document,
      operations: [
        { id: randomUUID(), kind: 'upsert', annotation: { ...annotation, comment: 'Edited' } },
      ],
    },
    origin,
  );
  expect(edited.document.annotations[0]).toMatchObject({
    status: 'resolved',
    replies: resolved.annotations[0]!.replies,
    comment: 'Edited',
  });
  expect(edited.document.annotations[0]!.updatedAt > resolved.annotations[0]!.updatedAt).toBe(true);
  await store.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'reopen', annotationId: annotation.id }] },
    origin,
  );
  expect(store.get(document.id).annotations[0]!.status).toBe('pending');
  await store.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'delete', annotationId: annotation.id }] },
    origin,
  );
  await store.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'upsert', annotation }] },
    origin,
  );
  expect(store.get(document.id).annotations).toEqual([]);
});

it('binds sessions to exact URLs and origins and requires an annotation within its named session', async () => {
  const store = await createFeedbackStore();
  const first = fixture();
  const second = fixture(`${origin}/second`);
  await store.sync(first.id, { document: first, operations: [] }, origin);
  await store.sync(second.id, { document: second, operations: [] }, origin);
  await expect(
    store.action(first.id, second.annotations[0]!.id, { kind: 'resolve' }),
  ).rejects.toMatchObject({ status: 404 });
  await expect(
    store.sync(
      first.id,
      { document: { ...first, url: `${origin}/other` }, operations: [] },
      origin,
    ),
  ).rejects.toMatchObject({ status: 409 });
  await expect(
    store.sync(first.id, { document: first, operations: [] }, 'http://localhost:5173'),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    store.sync(second.id, { document: first, operations: [] }, origin),
  ).rejects.toMatchObject({ status: 400 });
  expect(() => store.get(first.id, 'http://localhost:5173')).toThrow('Session not found');
  const copy = store.get(first.id);
  copy.annotations.length = 0;
  expect(store.get(first.id)).toEqual(first);
});

it('serializes concurrent actions and sync without losing replies or status', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  await Promise.all([
    store.action(document.id, annotation.id, { kind: 'resolve', summary: 'Resolved' }),
    store.sync(
      document.id,
      {
        document,
        operations: [
          {
            id: randomUUID(),
            kind: 'upsert',
            annotation: { ...annotation, comment: 'Browser edit' },
          },
        ],
      },
      origin,
    ),
    store.action(document.id, annotation.id, { kind: 'reply', message: 'Verified' }),
  ]);
  expect(store.get(document.id).annotations[0]).toMatchObject({
    status: 'resolved',
    comment: 'Browser edit',
    replies: [{ message: 'Resolved' }, { message: 'Verified' }],
  });
});

it.each(['snapshot', 'operation'] as const)(
  'rejects cross-page annotations in a sync %s before persisting or acknowledging them',
  async (source) => {
    const store = await createFeedbackStore();
    const document = fixture();
    await store.sync(document.id, { document, operations: [] }, origin);
    const foreign = fixture(`${origin}/other-page`).annotations[0]!;
    const operation: FeedbackOperation = { id: randomUUID(), kind: 'upsert', annotation: foreign };
    const changed = vi.fn();
    store.subscribe(document.id, changed);
    await expect(
      store.sync(
        document.id,
        {
          document: source === 'snapshot' ? { ...document, annotations: [foreign] } : document,
          operations: source === 'operation' ? [operation] : [],
        },
        origin,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(store.get(document.id)).toEqual(document);
    expect(changed).not.toHaveBeenCalled();
    foreign.page.url = document.url;
    const retried = await store.sync(document.id, { document, operations: [operation] }, origin);
    expect(retried.acknowledged).toEqual([operation.id]);
    expect(retried.document.annotations.at(-1)).toEqual(foreign);
  },
);

it('persists documents, deduplication IDs and tombstones with private filesystem permissions', async () => {
  const directory = await temporary();
  const filePath = join(directory, 'private', 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const annotation = document.annotations[0]!;
  const operation: FeedbackOperation = {
    id: randomUUID(),
    kind: 'upsert',
    annotation: { ...annotation, comment: 'Saved' },
  };
  await store.sync(document.id, { document, operations: [operation] }, origin);
  await store.action(document.id, annotation.id, { kind: 'resolve', summary: 'Persist together' });
  const reopened = await createFeedbackStore({ filePath });
  expect(reopened.get(document.id)).toEqual(store.get(document.id));
  await reopened.sync(
    document.id,
    {
      document,
      operations: [{ ...operation, annotation: { ...annotation, comment: 'Must be ignored' } }],
    },
    origin,
  );
  expect(reopened.get(document.id).annotations[0]!.comment).toBe('Saved');
  await reopened.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'delete', annotationId: annotation.id }] },
    origin,
  );
  const again = await createFeedbackStore({ filePath });
  await again.sync(
    document.id,
    { document, operations: [{ id: randomUUID(), kind: 'upsert', annotation }] },
    origin,
  );
  expect(again.get(document.id).annotations).toEqual([]);
  expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  expect((await stat(join(directory, 'private'))).mode & 0o777).toBe(0o700);
});

it('rolls back status, summary, operation IDs and notifications when persistence fails, then recovers', async () => {
  const directory = await temporary();
  const filePath = join(directory, 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  const saved = await readFile(filePath, 'utf8');
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  await rm(filePath);
  await mkdir(filePath);
  await expect(
    store.action(document.id, annotation.id, { kind: 'resolve', summary: 'Must roll back' }),
  ).rejects.toThrow();
  const operation: FeedbackOperation = {
    id: randomUUID(),
    kind: 'delete',
    annotationId: annotation.id,
  };
  await expect(
    store.sync(document.id, { document, operations: [operation] }, origin),
  ).rejects.toThrow();
  expect(store.get(document.id)).toEqual(document);
  expect(changed).not.toHaveBeenCalled();
  await rm(filePath, { recursive: true });
  await writeFile(filePath, saved);
  await store.sync(document.id, { document, operations: [operation] }, origin);
  expect(store.get(document.id).annotations).toEqual([]);
  expect(changed).toHaveBeenCalledTimes(1);
});

it('rejects malformed persistent files instead of resetting them', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  for (const content of [
    '{',
    '{}',
    JSON.stringify({
      version: 1,
      sessions: [
        { document: fixture(), origin: 'https://wrong.example', seen: [], tombstones: [] },
      ],
    }),
  ]) {
    await writeFile(filePath, content);
    await expect(createFeedbackStore({ filePath })).rejects.toThrow();
    expect(await readFile(filePath, 'utf8')).toBe(content);
  }
});

it('validates the entire mutation before committing any changes', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  annotation.replies = Array.from({ length: 500 }, () => ({
    id: randomUUID(),
    role: 'human',
    message: 'Existing',
    createdAt: document.createdAt,
  }));
  await store.sync(document.id, { document, operations: [] }, origin);
  await expect(
    store.action(document.id, annotation.id, { kind: 'resolve', summary: 'Too many replies' }),
  ).rejects.toThrow();
  expect(store.get(document.id)).toEqual(document);
  const edit: FeedbackOperation = {
    id: randomUUID(),
    kind: 'upsert',
    annotation: { ...annotation, comment: 'Should roll back' },
  };
  await expect(
    store.sync(
      document.id,
      {
        document,
        operations: [
          edit,
          {
            id: randomUUID(),
            kind: 'reply',
            annotationId: annotation.id,
            reply: {
              id: randomUUID(),
              role: 'human',
              message: 'Overflow',
              createdAt: document.createdAt,
            },
          },
        ],
      },
      origin,
    ),
  ).rejects.toThrow();
  expect(store.get(document.id)).toEqual(document);
  await store.sync(document.id, { document, operations: [edit] }, origin);
  expect(store.get(document.id).annotations[0]!.comment).toBe('Should roll back');
});

it('rejects additions at session and operation capacity without evicting retry history', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  const document = fixture();
  const seen = Array.from({ length: 10000 }, () => randomUUID());
  await writeFile(
    filePath,
    JSON.stringify({ version: 1, sessions: [{ document, origin, seen, tombstones: [] }] }),
  );
  const store = await createFeedbackStore({ filePath });
  const operation: FeedbackOperation = {
    id: randomUUID(),
    kind: 'delete',
    annotationId: document.annotations[0]!.id,
  };
  await expect(
    store.sync(document.id, { document, operations: [operation] }, origin),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    (
      await store.sync(
        document.id,
        { document, operations: [{ ...operation, id: seen[0]! }] },
        origin,
      )
    ).acknowledged,
  ).toEqual([seen[0]]);
  expect(store.get(document.id)).toEqual(document);
  const memory = await createFeedbackStore();
  for (let index = 0; index < 100; index++) {
    const session = fixture();
    await memory.sync(session.id, { document: session, operations: [] }, origin);
  }
  await expect(
    memory.sync(document.id, { document, operations: [] }, origin),
  ).rejects.toMatchObject({ status: 409 });
  expect(memory.list()).toHaveLength(100);
});

it('rejects annotation overflow without consuming operation IDs and accepts a retry after deletion', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  document.annotations = Array.from({ length: 1000 }, () => ({ ...annotation, id: randomUUID() }));
  await store.sync(document.id, { document, operations: [] }, origin);
  const operation: FeedbackOperation = { id: randomUUID(), kind: 'upsert', annotation };
  await expect(
    store.sync(document.id, { document, operations: [operation] }, origin),
  ).rejects.toThrow();
  expect(store.get(document.id)).toEqual(document);
  const response = await store.sync(
    document.id,
    {
      document,
      operations: [
        { id: randomUUID(), kind: 'delete', annotationId: document.annotations[0]!.id },
        operation,
      ],
    },
    origin,
  );
  expect(response.document.annotations).toHaveLength(1000);
  expect(response.document.annotations.at(-1)).toEqual(annotation);
});

it('isolates observers, makes unsubscribe repeatable, and does not emit for repeated status actions', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  const remove = store.subscribe(document.id, () => {});
  remove();
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  store.subscribe(document.id, () => {
    throw new Error('Observer failed');
  });
  remove();
  const acknowledged = await store.action(document.id, annotation.id, { kind: 'acknowledge' });
  expect(changed).toHaveBeenCalledTimes(1);
  expect(await store.action(document.id, annotation.id, { kind: 'acknowledge' })).toEqual(
    acknowledged,
  );
  expect(changed).toHaveBeenCalledTimes(1);
});

it('serializes duplicate creates, assigns timestamps, and ignores hidden conversation differences on retry', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  await store.sync(document.id, { document, operations: [] }, origin);
  const source = document.annotations[0]!;
  const input = {
    id: randomUUID(),
    comment: 'Created',
    page: source.page,
    targets: source.targets,
  };
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const [created, retry] = await Promise.all([
    store.createAnnotation(document.id, input),
    store.createAnnotation(document.id, input),
  ]);
  expect(retry).toEqual(created);
  const annotation = created.annotations.at(-1)!;
  expect(annotation).toEqual({
    ...input,
    createdAt: expect.any(String),
    updatedAt: annotation.createdAt,
    status: 'pending',
    replies: [],
  });
  expect(annotation.createdAt > source.createdAt).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
  const resolved = await store.action(document.id, input.id, {
    kind: 'resolve',
    summary: 'Hidden',
  });
  expect(await store.createAnnotation(document.id, input)).toEqual(resolved);
  expect(changed).toHaveBeenCalledTimes(2);
  for (const content of [
    { ...input, comment: 'Different' },
    { ...input, page: { ...input.page, title: 'Different' } },
    { ...input, targets: [{ ...input.targets[0]!, text: 'Different' }] },
  ]) {
    await expect(store.createAnnotation(document.id, content)).rejects.toMatchObject({
      status: 409,
    });
  }
  expect(store.get(document.id)).toEqual(resolved);
  expect(changed).toHaveBeenCalledTimes(2);
  created.annotations.length = 0;
  input.targets[0]!.text = 'Mutated input';
  expect(store.get(document.id)).toEqual(resolved);
});

it('persists CRUD edits alongside legacy replies, actions and stale offline outbox operations', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  const reply: FeedbackOperation = {
    id: randomUUID(),
    kind: 'reply',
    annotationId: annotation.id,
    reply: {
      id: randomUUID(),
      role: 'human',
      message: 'Offline context',
      createdAt: document.createdAt,
    },
  };
  await Promise.all([
    store.action(document.id, annotation.id, { kind: 'resolve', summary: 'Legacy agent reply' }),
    store.updateAnnotation(document.id, annotation.id, { comment: 'CRUD edit' }),
    store.sync(document.id, { document, operations: [reply] }, origin),
  ]);
  const saved = store.get(document.id).annotations[0]!;
  expect(saved).toMatchObject({
    id: annotation.id,
    createdAt: annotation.createdAt,
    comment: 'CRUD edit',
    status: 'resolved',
    replies: [
      { role: 'agent', message: 'Legacy agent reply' },
      { role: 'human', message: 'Offline context' },
    ],
  });
  const reopened = await createFeedbackStore({ filePath });
  expect(reopened.get(document.id)).toEqual(store.get(document.id));
  const changed = vi.fn();
  reopened.subscribe(document.id, changed);
  await reopened.sync(document.id, { document, operations: [reply] }, origin);
  await reopened.updateAnnotation(document.id, annotation.id, { comment: saved.comment });
  expect(changed).not.toHaveBeenCalled();

  await reopened.sync(
    document.id,
    {
      document,
      operations: [
        {
          id: randomUUID(),
          kind: 'upsert',
          annotation: { ...annotation, comment: 'Old outbox edit' },
        },
      ],
    },
    origin,
  );
  const edited = await reopened.updateAnnotation(document.id, annotation.id, {
    page: { ...annotation.page, title: 'Current page' },
    targets: [{ ...annotation.targets[0]!, text: 'Current target' }],
  });
  expect(edited.annotations[0]).toMatchObject({
    id: saved.id,
    createdAt: saved.createdAt,
    status: saved.status,
    replies: saved.replies,
    comment: 'Old outbox edit',
    page: { title: 'Current page' },
    targets: [{ text: 'Current target' }],
  });
  expect(edited.annotations[0]!.updatedAt > saved.updatedAt).toBe(true);
  const again = await createFeedbackStore({ filePath });
  expect(again.get(document.id)).toEqual(edited);
  await again.sync(
    document.id,
    {
      document,
      operations: [{ id: randomUUID(), kind: 'reopen', annotationId: annotation.id }],
    },
    origin,
  );
  expect(again.get(document.id).annotations[0]).toMatchObject({
    status: 'pending',
    replies: saved.replies,
  });
});

it('treats reordered context and normalized comments as no-op updates and advances effective edits monotonically', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const annotation = document.annotations[0]!;
  annotation.updatedAt = '2099-01-01T00:00:00.000Z';
  annotation.targets[0]!.attributes = { first: '1', second: '2' };
  await store.sync(document.id, { document, operations: [] }, origin);
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const input = {
    id: annotation.id,
    comment: ` ${annotation.comment} `,
    page: annotation.page,
    targets: [{ ...annotation.targets[0]!, attributes: { second: '2', first: '1' } }],
  };
  expect(await store.createAnnotation(document.id, input)).toEqual(document);
  expect(
    await store.updateAnnotation(document.id, annotation.id, {
      comment: input.comment,
      targets: input.targets,
    }),
  ).toEqual(document);
  expect(changed).not.toHaveBeenCalled();
  const edited = await store.updateAnnotation(document.id, annotation.id, { comment: 'Changed' });
  expect(edited.annotations[0]).toEqual({
    ...annotation,
    comment: 'Changed',
    updatedAt: '2099-01-01T00:00:00.001Z',
  });
  expect(changed).toHaveBeenCalledTimes(1);
  edited.annotations[0]!.replies.push({
    id: randomUUID(),
    role: 'agent',
    message: 'External mutation',
    createdAt: document.createdAt,
  });
  expect(store.get(document.id).annotations[0]!.replies).toEqual([]);
});

it('validates CRUD inputs, exact page URLs and session membership before committing', async () => {
  const store = await createFeedbackStore();
  const document = fixture();
  const other = fixture(`${origin}/other`);
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.sync(other.id, { document: other, operations: [] }, origin);
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const input = {
    id: randomUUID(),
    comment: annotation.comment,
    page: annotation.page,
    targets: annotation.targets,
  };
  for (const patch of [
    {},
    { comment: undefined },
    { comment: 'Edit', status: 'resolved' },
    { replies: [] },
    { unknown: true },
    { id: randomUUID() },
    { createdAt: document.createdAt },
    { updatedAt: document.createdAt },
    { comment: ' ' },
    { targets: [] },
  ]) {
    await expect(
      store.updateAnnotation(document.id, annotation.id, patch as AnnotationPatch),
    ).rejects.toThrow();
  }
  for (const content of [
    { ...input, status: 'resolved' },
    { ...input, replies: [] },
    { ...input, createdAt: document.createdAt },
    { ...input, updatedAt: document.createdAt },
  ]) {
    await expect(
      store.createAnnotation(document.id, content as CreateAnnotationInput),
    ).rejects.toThrow();
  }
  await expect(
    store.createAnnotation(document.id, { ...input, page: other.annotations[0]!.page }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    store.updateAnnotation(document.id, annotation.id, { page: other.annotations[0]!.page }),
  ).rejects.toMatchObject({ status: 400 });
  await expect(store.createAnnotation(randomUUID(), input)).rejects.toMatchObject({ status: 404 });
  for (const id of [other.annotations[0]!.id, randomUUID()]) {
    await expect(
      store.updateAnnotation(document.id, id, { comment: 'Edit' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(store.deleteAnnotation(document.id, id)).rejects.toMatchObject({ status: 404 });
  }
  expect(store.get(document.id)).toEqual(document);
  expect(store.get(other.id)).toEqual(other);
  expect(changed).not.toHaveBeenCalled();
});

it('persists delete tombstones, rejects recreation and stale upserts, and scopes retries to the session', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const other = fixture();
  const annotation = document.annotations[0]!;
  await store.sync(document.id, { document, operations: [] }, origin);
  await store.sync(other.id, { document: other, operations: [] }, origin);
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const [deleted, retry] = await Promise.all([
    store.deleteAnnotation(document.id, annotation.id),
    store.deleteAnnotation(document.id, annotation.id),
  ]);
  expect(deleted.annotations).toEqual([]);
  expect(retry).toEqual(deleted);
  expect(changed).toHaveBeenCalledTimes(1);
  const reopened = await createFeedbackStore({ filePath });
  const reloadedChanged = vi.fn();
  reopened.subscribe(document.id, reloadedChanged);
  expect(await reopened.deleteAnnotation(document.id, annotation.id)).toEqual(deleted);
  await expect(reopened.deleteAnnotation(other.id, annotation.id)).rejects.toMatchObject({
    status: 404,
  });
  await expect(
    reopened.updateAnnotation(document.id, annotation.id, { comment: 'Revive' }),
  ).rejects.toMatchObject({ status: 404 });
  const input = {
    id: annotation.id,
    comment: annotation.comment,
    page: annotation.page,
    targets: annotation.targets,
  };
  await expect(reopened.createAnnotation(document.id, input)).rejects.toMatchObject({
    status: 409,
  });
  const operation: FeedbackOperation = { id: randomUUID(), kind: 'upsert', annotation };
  const response = await reopened.sync(document.id, { document, operations: [operation] }, origin);
  expect(response).toMatchObject({ document: deleted, acknowledged: [operation.id] });
  expect(reloadedChanged).not.toHaveBeenCalled();
  expect((await reopened.createAnnotation(other.id, input)).annotations.at(-1)!.id).toBe(
    annotation.id,
  );
  expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(deleted);
});

it('rolls back each CRUD mutation and its notifications when persistence fails and recovers the queue', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  const store = await createFeedbackStore({ filePath });
  const document = fixture();
  const annotation = document.annotations[0]!;
  const input = {
    id: randomUUID(),
    comment: 'New',
    page: annotation.page,
    targets: annotation.targets,
  };
  await store.sync(document.id, { document, operations: [] }, origin);
  const saved = await readFile(filePath, 'utf8');
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  await rm(filePath);
  await mkdir(filePath);
  await expect(store.createAnnotation(document.id, input)).rejects.toThrow();
  await expect(
    store.updateAnnotation(document.id, annotation.id, { comment: 'Edit' }),
  ).rejects.toThrow();
  await expect(store.deleteAnnotation(document.id, annotation.id)).rejects.toThrow();
  expect(store.get(document.id)).toEqual(document);
  expect(changed).not.toHaveBeenCalled();
  await rm(filePath, { recursive: true });
  await writeFile(filePath, saved);
  await store.createAnnotation(document.id, input);
  await store.updateAnnotation(document.id, annotation.id, { comment: 'Edit' });
  const deleted = await store.deleteAnnotation(document.id, annotation.id);
  expect(deleted.annotations).toHaveLength(1);
  expect(deleted.annotations[0]!.id).toBe(input.id);
  expect(changed).toHaveBeenCalledTimes(3);
  expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(deleted);
});

it('enforces annotation and tombstone capacities for CRUD without losing existing data', async () => {
  const filePath = join(await temporary(), 'feedback.json');
  const document = fixture();
  const annotation = document.annotations[0]!;
  document.annotations = Array.from({ length: 1000 }, () => ({ ...annotation, id: randomUUID() }));
  const tombstones = Array.from({ length: 10000 }, () => randomUUID());
  await writeFile(
    filePath,
    JSON.stringify({ version: 1, sessions: [{ document, origin, seen: [], tombstones }] }),
  );
  const store = await createFeedbackStore({ filePath });
  const changed = vi.fn();
  store.subscribe(document.id, changed);
  const input = {
    id: randomUUID(),
    comment: 'Overflow',
    page: annotation.page,
    targets: annotation.targets,
  };
  await expect(store.createAnnotation(document.id, input)).rejects.toThrow();
  await expect(
    store.deleteAnnotation(document.id, document.annotations[0]!.id),
  ).rejects.toMatchObject({ status: 409 });
  expect(await store.deleteAnnotation(document.id, tombstones[0]!)).toEqual(document);
  expect(store.get(document.id)).toEqual(document);
  expect(changed).not.toHaveBeenCalled();
  expect((await createFeedbackStore({ filePath })).get(document.id)).toEqual(document);
});
