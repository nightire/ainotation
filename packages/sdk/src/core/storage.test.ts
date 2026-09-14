import type { Annotation, FeedbackOperation, SyncResponse } from '@ainotation/schema';
import { openDB } from 'idb';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { createDraftStore, type DraftStore } from './storage';
import { canvasBlob, describeImage } from './images';

const stores: DraftStore[] = [];
const keys: string[] = [];

async function openStore() {
  const onUnavailable = vi.fn();
  const store = await createDraftStore({ onUnavailable, onExternalChange: vi.fn() });
  stores.push(store);
  expect(onUnavailable).not.toHaveBeenCalled();
  expect(store.available).toBe(true);
  return store;
}

function pageKey() {
  const key = JSON.stringify([crypto.randomUUID(), location.href]);
  keys.push(key);
  return key;
}

function annotation(comment: string): Annotation {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    comment,
    createdAt: now,
    updatedAt: now,
    page: {
      url: location.href,
      title: 'Storage fixture',
      viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    },
    targets: [
      {
        id: crypto.randomUUID(),
        selector: '#storage-target',
        shadowHosts: [],
        tagName: 'button',
        text: 'Storage target',
        attributes: { id: 'storage-target' },
        rect: { x: 0, y: 0, width: 100, height: 30 },
        styles: {},
      },
    ],
    status: 'pending',
    replies: [],
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  if (!keys.length) return;
  const db = await openDB('ainotation-feedback', 1);
  try {
    for (const key of keys.splice(0)) await db.delete('pages', key);
  } finally {
    db.close();
  }
});

describe('draft storage in IndexedDB', () => {
  it('persists image blobs atomically with draft references, isolates pages and releases unreferenced images', async () => {
    const store = await openStore();
    const key = pageKey();
    const canvas = document.createElement('canvas');
    canvas.width = 10;
    canvas.height = 10;
    const blob = await canvasBlob(canvas);
    const image = await describeImage(blob, 'import');
    await store.update(key, location.href, (record) => ({
      ...record,
      draft: { ...record.draft, images: [image] },
      images: { [image.id]: blob },
    }));
    await store.close();
    const reopened = await openStore();
    const persisted = await reopened.load(key, location.href);
    expect(persisted.draft.images).toEqual([image]);
    expect(persisted.images?.[image.id]).toBeInstanceOf(Blob);
    expect(await persisted.images![image.id]!.arrayBuffer()).toEqual(await blob.arrayBuffer());
    expect((await reopened.load(pageKey(), location.href)).images).toEqual({});
    const cleared = await reopened.update(key, location.href, (record) => ({
      ...record,
      draft: { ...record.draft, images: [] },
    }));
    expect(cleared.images).toEqual({});
  });
  it('does not replay a failing reducer or downgrade storage for application errors', async () => {
    const store = await openStore();
    const key = pageKey();
    const before = await store.load(key, location.href);
    const change = vi.fn(() => {
      throw new Error('Invalid application transition');
    });
    await expect(store.update(key, location.href, change)).rejects.toThrow(
      'Invalid application transition',
    );
    expect(change).toHaveBeenCalledOnce();
    expect(store.available).toBe(true);
    expect(await store.read(key, location.href)).toEqual(before);
    await store.update(key, location.href, (record) => ({
      ...record,
      draft: { ...record.draft, text: 'Queue remains usable' },
    }));
    expect((await store.read(key, location.href)).draft.text).toBe('Queue remains usable');
  });

  it('preserves corrupt persisted data rather than replacing it with an empty in-memory record', async () => {
    const store = await openStore();
    const key = pageKey();
    const before = await store.load(key, location.href);
    const corrupt = { ...before, draft: null };
    const db = await openDB('ainotation-feedback', 1);
    try {
      await db.put('pages', corrupt, key);
      await expect(store.read(key, location.href)).rejects.toThrow('Stored feedback is invalid');
      const change = vi.fn((record) => record);
      await expect(store.update(key, location.href, change)).rejects.toThrow(
        'Stored feedback is invalid',
      );
      expect(change).not.toHaveBeenCalled();
      expect(store.available).toBe(true);
      expect(await db.get('pages', key)).toEqual(corrupt);
    } finally {
      db.close();
    }
  });

  it('reuses a validated transition once when the database write falls back to memory', async () => {
    const store = await openStore();
    const key = pageKey();
    await store.load(key, location.href);
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const change = vi.fn((record) => ({
      ...record,
      draft: { ...record.draft, text: 'Retain this edit' },
    }));
    const next = await store.update(key, location.href, change);
    expect(change).toHaveBeenCalledOnce();
    expect(store.available).toBe(false);
    expect((await store.read(key, location.href)).draft.text).toBe(next.draft.text);
    await expect(store.read(key, `${location.href}#another-page`)).rejects.toThrow(
      'Stored feedback is invalid',
    );
  });
  it('reads saved pages for one project after queued writes without mixing other projects', async () => {
    const store = await openStore();
    const project = `project-${crypto.randomUUID()}-",test`;
    const urls = ['http://localhost:5173/a', 'http://localhost:5173/b'];
    const pageKeys = urls.map((url) => JSON.stringify([project, url]));
    const other = JSON.stringify([crypto.randomUUID(), urls[0]]);
    keys.push(...pageKeys, other);
    const notes = urls.map((url, index) => {
      const note = annotation(`Page ${index}`);
      note.page.url = url;
      return note;
    });
    await store.mutate(pageKeys[0]!, urls[0]!, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: notes[0]!,
    });
    await store.mutate(other, urls[0]!, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: notes[0]!,
    });
    const pending = store.mutate(pageKeys[1]!, urls[1]!, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: notes[1]!,
    });
    const documents = await store.readProjectDocuments(project);
    await pending;
    expect(documents.map((document) => document.url)).toEqual(urls);
    expect(
      documents.flatMap((document) => document.annotations.map((note) => note.comment)),
    ).toEqual(['Page 0', 'Page 1']);
    expect(await store.readProjectDocuments('unknown-project')).toEqual([]);
  });
  it('clears a page atomically, queues deletions and resists stale sync without clearing newer drafts', async () => {
    const store = await openStore();
    const key = pageKey();
    const otherKey = pageKey();
    const first = annotation('First');
    const second = annotation('Second');
    await store.mutate(key, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: first,
    });
    const before = await store.mutate(key, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: second,
    });
    await store.mutate(otherKey, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: first,
    });
    await store.update(key, location.href, (record) => ({
      ...record,
      draft: { text: 'Old draft', editingId: first.id, targets: first.targets, editorOpen: true },
    }));
    const clearing = store.clearAnnotations(key, location.href, [first.id, second.id]);
    const fresh = {
      text: 'Started after clear',
      editingId: null,
      targets: first.targets,
      editorOpen: true,
    };
    const writing = store.update(key, location.href, (record) => ({ ...record, draft: fresh }));
    const cleared = await clearing;
    expect(cleared.document.annotations).toEqual([]);
    expect(cleared.document.id).toBe(before.document.id);
    expect(cleared.draft).toEqual({ text: '', editingId: null, targets: [], editorOpen: false });
    expect(
      cleared.operations
        .filter((operation) => operation.kind === 'delete')
        .map((operation) => operation.annotationId),
    ).toEqual([first.id, second.id]);
    await writing;
    const stale = await store.applySync(key, location.href, {
      document: before.document,
      acknowledged: before.operations.map((operation) => operation.id),
    });
    expect(stale.document.annotations).toEqual([]);
    expect(stale.draft).toEqual(fresh);
    const synced = await store.applySync(key, location.href, {
      document: stale.document,
      acknowledged: stale.operations.map((operation) => operation.id),
    });
    expect(synced.operations).toEqual([]);
    expect((await store.load(key, location.href)).document.annotations).toEqual([]);
    expect((await store.load(otherKey, location.href)).document.annotations).toEqual([first]);
  });

  it('commits a submitted annotation and clears only its matching draft atomically', async () => {
    const key = pageKey();
    const store = await openStore();
    const note = annotation('Submitted once');
    const draft = { text: note.comment, editingId: null, targets: note.targets, editorOpen: true };
    await store.update(key, location.href, (record) => ({ ...record, draft }));
    await store.mutate(
      key,
      location.href,
      { id: crypto.randomUUID(), kind: 'upsert', annotation: note },
      draft,
    );
    const saved = await store.read(key, location.href);
    expect(saved.document.annotations).toEqual([note]);
    expect(saved.draft).toMatchObject({ text: '', targets: [], editorOpen: false });
    await store.update(key, location.href, (record) => ({
      ...record,
      draft: { ...draft, text: 'A different new draft' },
    }));
    await store.mutate(
      key,
      location.href,
      { id: crypto.randomUUID(), kind: 'upsert', annotation: note },
      draft,
    );
    expect((await store.read(key, location.href)).draft.text).toBe('A different new draft');
  });

  it('keeps deleted edit text locally without restoring a deleted marker or reopening its editor', async () => {
    const key = pageKey();
    const store = await openStore();
    const note = annotation('Keep this edited text');
    const initial = await store.load(key, location.href);
    const operation: FeedbackOperation = {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: note,
    };
    const draft = {
      text: note.comment,
      editingId: note.id,
      targets: note.targets,
      editorOpen: true,
    };
    await store.update(key, location.href, (record) => ({ ...record, draft }));
    await store.mutate(key, location.href, operation, draft);
    const merged = await store.applySync(key, location.href, {
      document: initial.document,
      acknowledged: [operation.id],
    });
    expect(merged.document.annotations).toEqual([]);
    expect(merged.draft).toEqual({
      text: note.comment,
      editingId: null,
      targets: [],
      editorOpen: false,
    });
    expect((await store.load(key, location.href)).draft).toEqual(merged.draft);
    await store.update(key, location.href, (record) => ({ ...record, draft }));
    expect((await store.load(key, location.href)).draft).toEqual(merged.draft);
  });

  it('persists updates and keeps the document ID across load and close/reopen', async () => {
    const key = pageKey();
    const store = await openStore();
    const initial = await store.load(key, location.href);
    const target = annotation('Target fixture').targets[0]!;
    const updated = await store.update(key, location.href, (record) => ({
      ...record,
      draft: { text: 'Unsent feedback', editingId: null, targets: [target] },
    }));

    expect(updated.document.id).toBe(initial.document.id);
    expect(await store.read(key, location.href)).toEqual(updated);
    expect(await store.load(key, location.href)).toEqual(updated);
    const db = await openDB('ainotation-feedback', 1);
    try {
      expect(await db.get('pages', key)).toEqual(updated);
    } finally {
      db.close();
    }

    await store.close();
    const reopened = await openStore();
    expect(await reopened.read(key, location.href)).toEqual(updated);
    expect(await reopened.load(key, location.href)).toEqual(updated);
  });

  it('drains accepted writes on immediate close and rejects updates submitted after close', async () => {
    const key = pageKey();
    const store = await openStore();
    const initial = await store.load(key, location.href);
    const note = annotation('Queued before close');
    const operation: FeedbackOperation = {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: note,
    };
    const drafting = store.update(key, location.href, (record) => ({
      ...record,
      draft: { text: 'Also queued', editingId: null, targets: note.targets },
    }));
    const mutating = store.mutate(key, location.href, operation);
    const closing = store.close();
    const rejectedChange = vi.fn((record) => record);
    await expect(store.update(key, location.href, rejectedChange)).rejects.toThrow(
      'Storage closed',
    );
    await Promise.all([drafting, mutating, closing]);
    expect(rejectedChange).not.toHaveBeenCalled();

    const reopened = await openStore();
    const persisted = await reopened.read(key, location.href);
    expect(persisted.document).toEqual({ ...initial.document, annotations: [note] });
    expect(persisted.operations).toEqual([operation]);
    expect(persisted.draft).toEqual({
      text: 'Also queued',
      editingId: null,
      targets: note.targets,
    });
  });

  it('defaults legacy records to null authority and persists it without replacing feedback', async () => {
    const key = pageKey();
    const store = await openStore();
    const current = await store.mutate(key, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: annotation('Legacy feedback'),
    });
    expect(current.authority).toBeNull();
    await store.close();
    const { document, operations, draft } = current;
    const db = await openDB('ainotation-feedback', 1);
    try {
      await db.put('pages', { document, operations, draft }, key);
      const reopened = await openStore();
      expect(await reopened.read(key, location.href)).toEqual(current);
      expect(await reopened.load(key, location.href)).toEqual(current);
      expect(await db.get('pages', key)).toEqual(current);
    } finally {
      db.close();
    }
  });

  it('rotates sessions on A to B to A without losing newer feedback or reusing the old session', async () => {
    const key = pageKey();
    const store = await openStore();
    const endpointA = 'http://127.0.0.1:4748';
    const endpointB = 'http://127.0.0.1:4749';
    const first = await store.mutate(key, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: annotation('Created on A'),
    });
    const boundA = await store.bindAuthority(key, location.href, endpointA);
    expect(boundA).toEqual({ ...first, authority: endpointA });
    const syncedA = await store.applySync(key, location.href, {
      document: {
        ...boundA.document,
        annotations: boundA.document.annotations.map((note) => ({ ...note, status: 'resolved' })),
      },
      acknowledged: boundA.operations.map((operation) => operation.id),
    });
    expect(syncedA.operations).toEqual([]);

    const boundB = await store.bindAuthority(key, location.href, endpointB);
    expect(boundB.document.id).not.toBe(boundA.document.id);
    expect(boundB).toEqual({
      ...syncedA,
      authority: endpointB,
      document: { ...syncedA.document, id: boundB.document.id },
    });
    const newer = annotation('Created on B');
    const sentB = await store.mutate(key, location.href, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: newer,
    });
    await store.applySync(key, location.href, {
      document: {
        ...sentB.document,
        annotations: sentB.document.annotations.map((note) =>
          note.id === newer.id
            ? {
                ...note,
                status: 'acknowledged',
                replies: [
                  {
                    id: crypto.randomUUID(),
                    role: 'agent',
                    message: 'Investigating on B',
                    createdAt: new Date().toISOString(),
                  },
                ],
              }
            : note,
        ),
      },
      acknowledged: sentB.operations.map((operation) => operation.id),
    });
    const edit: FeedbackOperation = {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: { ...newer, comment: 'Local edit before returning to A' },
    };
    const latest = await store.mutate(key, location.href, edit);
    expect(latest.document.annotations.map((note) => note.status)).toEqual([
      'resolved',
      'acknowledged',
    ]);
    await store.close();

    const reopened = await openStore();
    expect(await reopened.read(key, location.href)).toEqual(latest);
    expect(await reopened.bindAuthority(key, location.href, endpointB)).toEqual(latest);
    const returnedA = await reopened.bindAuthority(key, location.href, endpointA);
    expect(new Set([boundA.document.id, boundB.document.id, returnedA.document.id]).size).toBe(3);
    expect(returnedA).toEqual({
      ...latest,
      authority: endpointA,
      document: { ...latest.document, id: returnedA.document.id },
    });
    expect(returnedA.operations).toEqual([edit]);
    await reopened.close();
    const finalStore = await openStore();
    expect(await finalStore.read(key, location.href)).toEqual(returnedA);
    expect(await finalStore.bindAuthority(key, location.href, endpointA)).toEqual(returnedA);
  });

  it.each(['one store', 'separate stores'] as const)(
    'preserves both concurrently submitted mutations through %s',
    async (mode) => {
      const key = pageKey();
      const first = await openStore();
      const second = mode === 'one store' ? first : await openStore();
      const initial = await first.load(key, location.href);
      const operations = ['First note', 'Second note'].map((comment) => ({
        id: crypto.randomUUID(),
        kind: 'upsert' as const,
        annotation: annotation(comment),
      }));

      await Promise.all([
        first.mutate(key, location.href, operations[0]!),
        second.mutate(key, location.href, operations[1]!),
      ]);

      const saved = await first.read(key, location.href);
      expect(saved.document.id).toBe(initial.document.id);
      expect(saved.document.annotations).toHaveLength(2);
      expect(saved.document.annotations).toEqual(
        expect.arrayContaining(operations.map((operation) => operation.annotation)),
      );
      expect(saved.operations).toHaveLength(2);
      expect(saved.operations).toEqual(expect.arrayContaining(operations));
      expect(await second.read(key, location.href)).toEqual(saved);
    },
  );

  it('rebases edits and deletes made during sync while retaining agent status and replies', async () => {
    const key = pageKey();
    const store = await openStore();
    const edited = annotation('Before sync');
    const deleted = annotation('Delete during sync');
    for (const note of [edited, deleted]) {
      await store.mutate(key, location.href, {
        id: crypto.randomUUID(),
        kind: 'upsert',
        annotation: note,
      });
    }
    const sent = await store.read(key, location.href);
    const agentReply = {
      id: crypto.randomUUID(),
      role: 'agent' as const,
      message: 'Fixed the layout',
      createdAt: new Date().toISOString(),
    };
    const response: SyncResponse = {
      document: {
        ...sent.document,
        annotations: sent.document.annotations.map((note) => ({
          ...note,
          status: 'resolved',
          replies: [agentReply],
        })),
      },
      acknowledged: sent.operations.map((operation) => operation.id),
    };
    const edit: FeedbackOperation = {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: { ...edited, comment: 'Edited while syncing' },
    };
    const remove: FeedbackOperation = {
      id: crypto.randomUUID(),
      kind: 'delete',
      annotationId: deleted.id,
    };
    await Promise.all([
      store.mutate(key, location.href, edit),
      store.mutate(key, location.href, remove),
      store.update(key, location.href, (record) => ({
        ...record,
        draft: { ...record.draft, text: 'Another unsent note' },
      })),
    ]);

    const merged = await store.applySync(key, location.href, response);
    expect(merged.document.id).toBe(sent.document.id);
    expect(merged.document.annotations).toEqual([
      {
        ...edited,
        comment: 'Edited while syncing',
        status: 'resolved',
        replies: [agentReply],
      },
    ]);
    expect(merged.operations).toEqual([edit, remove]);
    expect(merged.draft.text).toBe('Another unsent note');

    await store.close();
    const reopened = await openStore();
    expect(await reopened.read(key, location.href)).toEqual(merged);
  });
});
