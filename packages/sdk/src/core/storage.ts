import type { DBSchema, IDBPDatabase } from 'idb';
import type { EditorPresentation } from './types';
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
  SyncRequestSchema,
  SyncResponseSchema,
  normalizeSharedStyles,
  styleTargetKey,
} from '@ainotation/schema';
import type {
  FeedbackDocument,
  FeedbackOperation,
  SyncResponse,
  TargetSnapshot,
  MarkerAnchor,
  PageSnapshot,
  FeedbackImage,
  SyncRequest,
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
    targetsAdjusted?: boolean;
    styleTargets?: TargetSnapshot[];
    editorSessionId?: string;
  };
  images?: Record<string, Blob>;
  styleDrafts?: TargetSnapshot[];
  stylePreview?: { enabled: boolean; disabledTargets: string[] };
  editorViews?: Record<string, EditorPresentation>;
  authority: string | null;
  storageEpoch?: string;
  syncRecovery?: Pick<NonNullable<SyncRequest['recovery']>, 'epoch' | 'revision'> & {
    server?: FeedbackDocument | undefined;
  };
  recoveryCopies?: { document: FeedbackDocument; images: Record<string, Blob> }[];
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

/** Delete local overrides in the same transaction that removes their last saved reference. */
function pruneRemovedStyleTargets(previous: DraftRecord, next: DraftRecord): DraftRecord {
  const keys = (document: FeedbackDocument) =>
    new Set(document.annotations.flatMap((annotation) => annotation.targets.map(styleTargetKey)));
  const retained = keys(next.document);
  const removed = new Set([...keys(previous.document)].filter((key) => !retained.has(key)));
  if (!removed.size) return next;
  const keep = (target: TargetSnapshot) => !removed.has(styleTargetKey(target));
  if (next.styleDrafts) next.styleDrafts = next.styleDrafts.filter(keep);
  if (next.draft.styleTargets) next.draft.styleTargets = next.draft.styleTargets.filter(keep);
  if (next.stylePreview)
    next.stylePreview.disabledTargets = next.stylePreview.disabledTargets.filter(
      (id) => !removed.has(id),
    );
  return next;
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
      const document = normalizeSharedStyles(FeedbackDocumentSchema.parse(value.document));
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
      const editorViews: Record<string, EditorPresentation> = {};
      for (const [id, presentation] of Object.entries(value.editorViews ?? {}).slice(-1001)) {
        if (
          !TargetSnapshotSchema.shape.id.safeParse(id).success ||
          !presentation ||
          typeof presentation !== 'object'
        )
          continue;
        const targets = TargetSnapshotSchema.shape.id
          .array()
          .max(20)
          .safeParse(presentation.targets);
        if (!targets.success) continue;
        const position = MarkerAnchorSchema.pick({ x: true, y: true }).safeParse(
          presentation.position,
        );
        editorViews[id] = {
          tab: presentation.tab === 'styles' ? 'styles' : 'feedback',
          targets: targets.data,
          position: position.success ? position.data : null,
        };
        const navigation = presentation.navigation;
        if (
          navigation &&
          Array.isArray(navigation.slots) &&
          navigation.slots.length > 0 &&
          navigation.slots.length <= 20
        ) {
          const references = TargetSnapshotSchema.shape.id
            .array()
            .max(20)
            .safeParse(navigation.referenceIds);
          const slots = navigation.slots.map((slot) => {
            const target = TargetSnapshotSchema.safeParse(slot?.target);
            const history = TargetSnapshotSchema.array().max(64).safeParse(slot?.history);
            if (!target.success || !history.success) return null;
            const path = [...history.data, target.data].map((entry) => entry.id);
            if (new Set(path).size !== path.length) return null;
            return { target: target.data, history: history.data };
          });
          if (
            references.success &&
            slots.every((slot) => slot !== null) &&
            new Set(slots.map((slot) => slot.target.id)).size === slots.length
          )
            editorViews[id]!.navigation = { slots, referenceIds: references.data };
        }
      }
      return {
        images,
        ...(Object.keys(editorViews).length ? { editorViews } : {}),
        ...(value.styleDrafts
          ? { styleDrafts: TargetSnapshotSchema.array().max(20000).parse(value.styleDrafts) }
          : {}),
        ...(value.stylePreview
          ? {
              stylePreview: {
                enabled: value.stylePreview.enabled === true,
                disabledTargets: value.stylePreview.disabledTargets
                  .filter((id) => typeof id === 'string')
                  .slice(0, 20000),
              },
            }
          : {}),
        ...(typeof value.multipleSelection === 'boolean'
          ? { multipleSelection: value.multipleSelection }
          : {}),
        document,
        ...(value.recoveryCopies
          ? {
              recoveryCopies: value.recoveryCopies.slice(-3).map((copy) => ({
                document: FeedbackDocumentSchema.parse(copy.document),
                images: Object.fromEntries(
                  Object.entries(copy.images).filter(([, blob]) => blob instanceof Blob),
                ),
              })),
            }
          : {}),
        ...(value.storageEpoch
          ? {
              storageEpoch: SyncResponseSchema.shape.storageEpoch
                .unwrap()
                .parse(value.storageEpoch),
            }
          : {}),
        ...(value.syncRecovery
          ? {
              syncRecovery: SyncRequestSchema.shape.recovery
                .unwrap()
                .omit({ source: true })
                .extend({ server: FeedbackDocumentSchema.optional() })
                .parse(value.syncRecovery),
            }
          : {}),
        operations: FeedbackOperationSchema.array().max(1000).parse(value.operations),
        authority: typeof value.authority === 'string' ? value.authority : null,
        draft: {
          text: typeof value.draft.text === 'string' ? value.draft.text.slice(0, 10000) : '',
          editingId: typeof value.draft.editingId === 'string' ? value.draft.editingId : null,
          ...(TargetSnapshotSchema.shape.id.safeParse(value.draft.editorSessionId).success
            ? { editorSessionId: value.draft.editorSessionId! }
            : {}),
          ...(value.draft.targetsAdjusted ? { targetsAdjusted: true } : {}),
          targets: TargetSnapshotSchema.array().max(20).parse(value.draft.targets),
          ...(value.draft.styleTargets
            ? { styleTargets: TargetSnapshotSchema.array().max(20).parse(value.draft.styleTargets) }
            : {}),
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
    const transition = (previous: DraftRecord) =>
      pruneRemovedStyleTargets(previous, parse(change(structuredClone(previous)), url));
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
            next = transition(previous);
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
      next ??= transition(previous);
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
      return update(key, url, (record) => {
        if (record.authority && record.authority !== authority) {
          delete record.storageEpoch;
          delete record.syncRecovery;
          record.document = { ...record.document, id: crypto.randomUUID() };
        }
        return { ...record, authority };
      });
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
            draft.styleTargets ?? [],
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
        if (response.recovery)
          throw new Error('Recovery conflicts must be resolved before applying server data.');
        if (record.document.id !== response.document.id || response.document.url !== url)
          throw new Error('MCP session mismatch');
        if (record.syncRecovery) {
          record.recoveryCopies = [
            ...(record.recoveryCopies ?? []),
            { document: record.document, images: record.images ?? {} },
          ].slice(-3);
          delete record.syncRecovery;
        }
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
          ...(response.storageEpoch ? { storageEpoch: response.storageEpoch } : {}),
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
        styleDrafts: [],
        stylePreview: { enabled: record.stylePreview?.enabled ?? true, disabledTargets: [] },
        editorViews: {},
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
