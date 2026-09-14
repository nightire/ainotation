import type { DBSchema, IDBPDatabase } from 'idb';
import { openDatabase } from './database';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  FeedbackDocumentSchema,
  FeedbackOperationSchema,
  TargetSnapshotSchema,
  MarkerAnchorSchema,
  PageSnapshotSchema,
  FeedbackImagesSchema,
} from '@ainotation/schema';
import type {
  FeedbackDocument,
  FeedbackOperation,
  SyncResponse,
  TargetSnapshot,
  MarkerAnchor,
  PageSnapshot,
  FeedbackImage,
} from '@ainotation/schema';

export interface DraftRecord {
  document: FeedbackDocument;
  operations: FeedbackOperation[];
  draft: {
    text: string;
    editingId: string | null;
    targets: TargetSnapshot[];
    marker?: MarkerAnchor;
    editorOpen?: boolean;
    page?: PageSnapshot;
    images?: FeedbackImage[];
  };
  images?: Record<string, Blob>;
  authority: string | null;
  multipleSelection?: boolean;
}
interface FeedbackDatabase extends DBSchema {
  pages: { key: string; value: DraftRecord };
}

class InvalidDraftRecordError extends Error {
  constructor(cause: unknown) {
    super('Stored feedback is invalid or belongs to another page.', { cause });
    this.name = 'InvalidDraftRecordError';
  }
}

export async function createDraftStore(options: {
  onUnavailable: () => void;
  onExternalChange: () => void;
}) {
  let db: IDBPDatabase<FeedbackDatabase> | undefined;
  let closed = false;
  const memory = new Map<string, DraftRecord>();
  let channel: BroadcastChannel | undefined;
  try {
    channel = new BroadcastChannel('ainotation-feedback');
  } catch {
    /* Cross-tab updates are optional. */
  }
  if (channel)
    channel.onmessage = () => {
      if (!closed) options.onExternalChange();
    };
  const unavailable = () => {
    db?.close();
    db = undefined;
    options.onUnavailable();
  };
  try {
    db = await openDatabase<FeedbackDatabase>('ainotation-feedback', 1, {
      upgrade(database) {
        database.createObjectStore('pages');
      },
      blocking() {
        unavailable();
      },
      terminated() {
        unavailable();
      },
    });
  } catch {
    unavailable();
  }

  const initial = (url: string): DraftRecord => ({
    document: createFeedbackDocument(url),
    operations: [],
    draft: { text: '', editingId: null, targets: [] },
    authority: null,
  });
  const parse = (input: unknown, url?: string): DraftRecord => {
    try {
      if (
        !input ||
        typeof input !== 'object' ||
        !('draft' in input) ||
        !input.draft ||
        typeof input.draft !== 'object'
      )
        throw new Error('Invalid draft envelope');
      const value = input as DraftRecord;
      const document = FeedbackDocumentSchema.parse(value.document);
      if (url !== undefined && document.url !== url) throw new Error('Stored page mismatch');
      const draftImages = FeedbackImagesSchema.parse(value.draft.images ?? []);
      const referenced = new Set(
        [
          ...document.annotations.flatMap((annotation) => annotation.images ?? []),
          ...draftImages,
        ].map((image) => image.id),
      );
      const images = Object.fromEntries(
        Object.entries(value.images ?? {}).filter(
          ([id, blob]) => referenced.has(id) && blob instanceof Blob,
        ),
      );
      return {
        images,
        ...(typeof value.multipleSelection === 'boolean'
          ? { multipleSelection: value.multipleSelection }
          : {}),
        document,
        operations: FeedbackOperationSchema.array().max(1000).parse(value.operations),
        authority: typeof value.authority === 'string' ? value.authority : null,
        draft: {
          text: typeof value.draft.text === 'string' ? value.draft.text.slice(0, 10000) : '',
          editingId: typeof value.draft.editingId === 'string' ? value.draft.editingId : null,
          targets: TargetSnapshotSchema.array().max(20).parse(value.draft.targets),
          ...(draftImages.length ? { images: draftImages } : {}),
          ...(value.draft.marker ? { marker: MarkerAnchorSchema.parse(value.draft.marker) } : {}),
          ...(value.draft.page ? { page: PageSnapshotSchema.parse(value.draft.page) } : {}),
          ...(typeof value.draft.editorOpen === 'boolean'
            ? { editorOpen: value.draft.editorOpen }
            : {}),
        },
      };
    } catch (error) {
      throw new InvalidDraftRecordError(error);
    }
  };
  let queue: Promise<unknown> = Promise.resolve();
  let closing: Promise<void> | undefined;
  function update(
    key: string,
    url: string,
    change: (record: DraftRecord) => DraftRecord,
  ): Promise<DraftRecord> {
    if (closed) return Promise.reject(new Error('Storage closed'));
    const work = queue.then(async () => {
      let previous = memory.get(key) ?? initial(url);
      let next: DraftRecord | undefined;
      if (db) {
        let reducing = false;
        try {
          const transaction = db.transaction('pages', 'readwrite');
          try {
            const saved = await transaction.store.get(key);
            previous = saved ? parse(saved, url) : previous;
            reducing = true;
            next = parse(change(structuredClone(previous)), url);
            reducing = false;
            await transaction.store.put(next, key);
            await transaction.done;
          } catch (error) {
            try {
              transaction.abort();
            } catch {
              /* It may already be complete. */
            }
            await transaction.done.catch(() => {});
            throw error;
          }
          memory.set(key, next);
          try {
            channel?.postMessage(key);
          } catch {
            /* Cross-tab notifications do not determine durability. */
          }
          return structuredClone(next);
        } catch (error) {
          // Only I/O failures permit an in-memory fallback. Never replay a reducer
          // or replace a corrupt persisted record with a new empty document.
          if (reducing || error instanceof InvalidDraftRecordError) throw error;
          unavailable();
        }
      }
      if (previous.document.url !== url) throw new InvalidDraftRecordError('Stored page mismatch');
      next ??= parse(change(structuredClone(previous)), url);
      memory.set(key, next);
      return structuredClone(next);
    });
    queue = work.catch(() => {});
    return work;
  }
  async function read(key: string, url: string): Promise<DraftRecord> {
    await queue;
    if (closed) throw new Error('Storage closed');
    if (db) {
      try {
        const saved = await db.get('pages', key);
        if (saved) {
          const parsed = parse(saved, url);
          memory.set(key, parsed);
          return structuredClone(parsed);
        }
      } catch (error) {
        if (error instanceof InvalidDraftRecordError) throw error;
        unavailable();
      }
    }
    return structuredClone(parse(memory.get(key) ?? initial(url), url));
  }
  return {
    get available() {
      return !!db;
    },
    read,
    async readProjectDocuments(project: string): Promise<FeedbackDocument[]> {
      await queue;
      if (closed) throw new Error('Storage closed');
      const prefix = `${JSON.stringify([project]).slice(0, -1)},`;
      if (db) {
        let completion: Promise<void> | undefined;
        try {
          const transaction = db.transaction('pages', 'readonly');
          completion = transaction.done;
          let cursor = await transaction.store.openCursor(
            IDBKeyRange.bound(prefix, `${prefix}\uffff`),
          );
          const documents: FeedbackDocument[] = [];
          while (cursor) {
            const record = parse(cursor.value);
            if (cursor.key !== JSON.stringify([project, record.document.url]))
              throw new InvalidDraftRecordError('Stored page mismatch');
            memory.set(cursor.key, record);
            documents.push(record.document);
            cursor = await cursor.continue();
          }
          await transaction.done;
          return structuredClone(documents.sort((a, b) => a.url.localeCompare(b.url)));
        } catch (error) {
          await completion?.catch(() => {});
          if (error instanceof InvalidDraftRecordError) throw error;
          unavailable();
        }
      }
      return structuredClone(
        [...memory]
          .filter(([key, record]) => key === JSON.stringify([project, record.document.url]))
          .map(([, record]) => record.document)
          .sort((a, b) => a.url.localeCompare(b.url)),
      );
    },
    update,
    async load(key: string, url: string) {
      return update(key, url, (record) => {
        if (
          record.draft.editingId &&
          !record.document.annotations.some(
            (annotation) => annotation.id === record.draft.editingId,
          )
        ) {
          record.draft = {
            text: record.draft.text,
            ...(record.draft.images?.length ? { images: record.draft.images } : {}),
            editingId: null,
            targets: [],
            editorOpen: false,
          };
        }
        return record;
      });
    },
    bindAuthority(key: string, url: string, authority: string) {
      return update(key, url, (record) => ({
        ...record,
        authority,
        document:
          record.authority && record.authority !== authority
            ? { ...record.document, id: crypto.randomUUID() }
            : record.document,
      }));
    },
    mutate(
      key: string,
      url: string,
      operation: FeedbackOperation,
      submittedDraft?: DraftRecord['draft'],
    ) {
      return update(key, url, (record) => {
        const identity = (draft: DraftRecord['draft']) =>
          JSON.stringify([
            draft.text,
            draft.editingId,
            draft.targets,
            draft.marker,
            draft.page,
            draft.images ?? [],
          ]);
        const clearDraft = submittedDraft && identity(record.draft) === identity(submittedDraft);
        return {
          ...record,
          document: applyFeedbackOperation(record.document, operation),
          operations: [...record.operations, operation],
          ...(clearDraft
            ? { draft: { text: '', editingId: null, targets: [], editorOpen: false } }
            : {}),
        };
      });
    },
    applySync(key: string, url: string, response: SyncResponse, images: Record<string, Blob> = {}) {
      return update(key, url, (record) => {
        if (record.document.id !== response.document.id || response.document.url !== url)
          throw new Error('MCP session mismatch');
        const acknowledged = new Set(response.acknowledged);
        const operations = record.operations.filter((operation) => !acknowledged.has(operation.id));
        const document = operations.reduce(applyFeedbackOperation, response.document);
        let draft = record.draft;
        if (
          draft.editingId &&
          !document.annotations.some((annotation) => annotation.id === draft.editingId)
        ) {
          draft = {
            text: draft.text,
            ...(draft.images?.length ? { images: draft.images } : {}),
            editingId: null,
            targets: [],
            editorOpen: false,
          };
        }
        const deletedEdit = [...record.operations]
          .reverse()
          .find(
            (operation) =>
              operation.kind === 'upsert' &&
              acknowledged.has(operation.id) &&
              !document.annotations.some(
                (annotation) => annotation.id === operation.annotation.id,
              ) &&
              !record.operations.some(
                (later) =>
                  later.kind === 'delete' && later.annotationId === operation.annotation.id,
              ),
          );
        if (!draft.text && deletedEdit?.kind === 'upsert') {
          draft = {
            text: deletedEdit.annotation.comment,
            ...(deletedEdit.annotation.images?.length
              ? { images: deletedEdit.annotation.images }
              : {}),
            editingId: null,
            targets: [],
            editorOpen: false,
          };
        }
        return {
          ...record,
          document,
          images: { ...record.images, ...images },
          operations,
          draft,
        };
      });
    },
    clearAnnotations(key: string, url: string, annotationIds: string[]) {
      const operations: FeedbackOperation[] = [...new Set(annotationIds)].map((annotationId) => ({
        id: crypto.randomUUID(),
        kind: 'delete',
        annotationId,
      }));
      return update(key, url, (record) => ({
        ...record,
        document: operations.reduce(applyFeedbackOperation, record.document),
        operations: [...record.operations, ...operations],
        draft: { text: '', editingId: null, targets: [], editorOpen: false },
      }));
    },
    close() {
      closed = true;
      if (channel) channel.onmessage = null;
      closing ??= queue.then(() => {
        channel?.close();
        db?.close();
        memory.clear();
      });
      return closing;
    },
  };
}

export type DraftStore = Awaited<ReturnType<typeof createDraftStore>>;
