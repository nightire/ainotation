import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile, stat, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import {
  AnnotationContentSchema,
  applyFeedbackOperation,
  FeedbackDocumentSchema,
  SyncRequestSchema,
  SyncResponseSchema,
  type FeedbackDocument,
  type SyncRequest,
  type SyncResponse,
  type FeedbackImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
} from '@ainotation/schema';
import { z } from 'zod';
import { readSnapshot, writeSnapshot, exists } from './recovery-json';
import { writePrivateJson } from './atomic-json';

const MAX_SESSIONS = 100;
const MAX_OPERATION_IDS = 10000;
const SessionSchema = z
  .object({
    document: FeedbackDocumentSchema,
    origin: z.string(),
    seen: z.array(z.uuid()).max(MAX_OPERATION_IDS),
    tombstones: z.array(z.uuid()).max(MAX_OPERATION_IDS),
  })
  .strict();
const FileSchema = z
  .object({
    version: z.literal(1),
    storageEpoch: z.uuid().optional(),
    sessions: z.array(SessionSchema).max(MAX_SESSIONS),
  })
  .strict();
type Session = z.infer<typeof SessionSchema>;

export const CreateAnnotationSchema = AnnotationContentSchema.pick({
  id: true,
  comment: true,
  page: true,
  targets: true,
}).strict();
export const AnnotationPatchSchema = CreateAnnotationSchema.omit({ id: true })
  .partial()
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'At least one annotation field is required',
  });
export type CreateAnnotationInput = z.infer<typeof CreateAnnotationSchema>;
export type AnnotationPatch = z.infer<typeof AnnotationPatchSchema>;

export const AgentActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reply'), message: z.string().trim().min(1).max(10000) }).strict(),
  z
    .object({
      kind: z.literal('acknowledge'),
      summary: z.string().trim().min(1).max(10000).optional(),
    })
    .strict(),
  z
    .object({ kind: z.literal('resolve'), summary: z.string().trim().min(1).max(10000).optional() })
    .strict(),
  z
    .object({ kind: z.literal('dismiss'), reason: z.string().trim().min(1).max(10000).optional() })
    .strict(),
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export class StoreError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'StoreError';
  }
}

function documentOrigin(document: FeedbackDocument): string {
  const url = new URL(document.url);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new StoreError(400, 'Document URL must be an HTTP(S) URL without credentials');
  }
  return url.origin;
}

function validateSession(session: Session): void {
  SessionSchema.parse(session);
  const ids = session.document.annotations.map((annotation) => annotation.id);
  const images = new Map<string, FeedbackImage>();
  for (const image of session.document.annotations.flatMap(
    (annotation) => annotation.images ?? [],
  )) {
    const previous = images.get(image.id);
    if (previous && !isDeepStrictEqual(previous, image))
      throw new StoreError(400, 'Conflicting image attachment metadata');
    images.set(image.id, image);
  }
  if (
    documentOrigin(session.document) !== session.origin ||
    new Set(ids).size !== ids.length ||
    new Set(session.seen).size !== session.seen.length ||
    new Set(session.tombstones).size !== session.tombstones.length ||
    ids.some((id) => session.tombstones.includes(id)) ||
    session.document.annotations.some(
      (annotation) =>
        new Set(annotation.replies.map((reply) => reply.id)).size !== annotation.replies.length,
    )
  ) {
    throw new StoreError(400, 'Invalid session state');
  }
}

/** A synchronous memory store; use createFeedbackStore to open persistent storage. */
export class FeedbackStore {
  private images = new Map<string, Buffer>();
  private sessions = new Map<string, Session>();
  private queue: Promise<void> = Promise.resolve();
  private listeners = new Map<string, Set<() => void>>();
  private stamp = '';
  private missing = new Map<string, string>();

  constructor(
    private readonly filePath?: string,
    sessions: Session[] = [],
    readonly storageEpoch: string = randomUUID(),
  ) {
    for (const session of sessions) {
      validateSession(session);
      if (this.sessions.has(session.document.id)) throw new StoreError(400, 'Duplicate session ID');
      this.sessions.set(session.document.id, structuredClone(session));
    }
  }

  list(): FeedbackDocument[] {
    return [...this.sessions.values()].map((session) => structuredClone(session.document));
  }

  async flush(): Promise<void> {
    await this.queue;
  }

  private snapshot() {
    return {
      version: 1 as const,
      storageEpoch: this.storageEpoch,
      sessions: [...this.sessions.values()],
    };
  }
  private async fileStamp() {
    if (!this.filePath) return '';
    try {
      const value = await stat(this.filePath);
      return `${value.ino}:${value.mtimeMs}:${value.size}`;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }
  private async checkpoint(force = false) {
    if (!this.filePath) return;
    const stamp = await this.fileStamp();
    if (!force && stamp && stamp === this.stamp) return;
    if (!force && stamp) {
      let disk;
      try {
        disk = parseFeedbackFile(JSON.parse(await readFile(this.filePath, 'utf8')));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code) throw error;
        await rename(this.filePath, `${this.filePath}.corrupt-${randomUUID()}`);
      }
      if (disk && !isDeepStrictEqual(disk, this.snapshot()))
        throw new StoreError(
          409,
          'Storage changed outside this service. Run ainotation-mcp doctor.',
          'storage-conflict',
        );
      if (disk) {
        this.stamp = stamp;
        return;
      }
    }
    await writeSnapshot(this.filePath, this.snapshot());
    this.stamp = await this.fileStamp();
  }
  async repair(force = false) {
    await this.mutate(async () => {
      await this.checkpoint(force);
      for (const session of this.sessions.values()) {
        if (!this.listeners.get(session.document.id)?.size) continue;
        const missing = await this.missingImages(session.document);
        const signature = missing.sort().join(',');
        if (signature && this.missing.get(session.document.id) !== signature)
          for (const listener of this.listeners.get(session.document.id) ?? []) {
            try {
              listener();
            } catch {
              /* A disconnected observer cannot break repair. */
            }
          }
        this.missing.set(session.document.id, signature);
      }
    });
  }

  async missingImages(document: FeedbackDocument): Promise<string[]> {
    const missing: string[] = [];
    for (const image of document.annotations.flatMap((annotation) => annotation.images ?? [])) {
      if (this.filePath) {
        try {
          if ((await stat(this.imagePath(document.id, image.id))).size !== image.size)
            missing.push(image.id);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') missing.push(image.id);
          else throw error;
        }
      } else if (!this.images.has(`${document.id}/${image.id}`)) missing.push(image.id);
    }
    return [...new Set(missing)];
  }
  private async preserveRecovery(document: FeedbackDocument) {
    if (!this.filePath) return;
    const directory = `${this.filePath}.recovery`;
    const hash = createHash('sha256').update(JSON.stringify(document)).digest('hex');
    const path = join(directory, `${document.id}-${hash}.json`);
    if (await exists(path)) return;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    if ((await readdir(directory)).length >= 100)
      throw new StoreError(
        409,
        'Recovery snapshot limit reached. Export and archive recovery files before retrying.',
      );
    await writePrivateJson(path, document);
  }

  get(sessionId: string, origin?: string): FeedbackDocument {
    z.uuid().parse(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session || (origin !== undefined && session.origin !== origin)) {
      throw new StoreError(404, 'Session not found');
    }
    return structuredClone(session.document);
  }

  image(sessionId: string, imageId: string, origin?: string): FeedbackImage {
    z.uuid().parse(imageId);
    const image = this.get(sessionId, origin)
      .annotations.flatMap((annotation) => annotation.images ?? [])
      .find((image) => image.id === imageId);
    if (!image) throw new StoreError(404, 'Image not found in session');
    return image;
  }

  private imagePath(sessionId: string, imageId: string): string {
    return join(`${this.filePath}.images`, sessionId, `${imageId}.png`);
  }

  async getImage(sessionId: string, imageId: string, origin?: string): Promise<Buffer> {
    this.image(sessionId, imageId, origin);
    let bytes = this.images.get(`${sessionId}/${imageId}`);
    if (!bytes && this.filePath) {
      try {
        bytes = await readFile(this.imagePath(sessionId, imageId));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    if (!bytes) throw new StoreError(404, 'Image has not been uploaded yet');
    this.validateImage(bytes, this.image(sessionId, imageId, origin));
    return Buffer.from(bytes);
  }

  private validateImage(bytes: Buffer, image: FeedbackImage) {
    if (
      bytes.length !== image.size ||
      bytes.length > MAX_IMAGE_BYTES ||
      bytes.length < 33 ||
      bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      bytes.toString('ascii', 12, 16) !== 'IHDR' ||
      bytes.readUInt32BE(16) !== image.width ||
      bytes.readUInt32BE(20) !== image.height ||
      image.width * image.height > MAX_IMAGE_PIXELS ||
      createHash('sha256').update(bytes).digest('hex') !== image.sha256
    )
      throw new StoreError(400, 'Image contents do not match attachment metadata');
  }

  async putImage(sessionId: string, imageId: string, bytes: Buffer, origin: string): Promise<void> {
    await this.mutate(async () => {
      const image = this.image(sessionId, imageId, origin);
      this.validateImage(bytes, image);
      if (this.filePath) {
        const path = this.imagePath(sessionId, imageId);
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        const temporary = `${path}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
          await rename(temporary, path);
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      } else this.images.set(`${sessionId}/${imageId}`, Buffer.from(bytes));
      this.missing.delete(sessionId);
    });
  }

  subscribe(sessionId: string, listener: () => void): () => void {
    this.get(sessionId);
    let listeners = this.listeners.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(sessionId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && this.listeners.get(sessionId) === listeners)
        this.listeners.delete(sessionId);
    };
  }

  private mutate<T>(run: () => Promise<T>): Promise<T> {
    const result = this.queue.then(run);
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async commit(session: Session, preserveImages = false): Promise<void> {
    validateSession(session);
    await this.checkpoint();
    const previous = this.sessions.get(session.document.id);
    const previousImages = new Map(
      previous?.document.annotations
        .flatMap((annotation) => annotation.images ?? [])
        .map((image) => [image.id, image]),
    );
    for (const image of session.document.annotations.flatMap(
      (annotation) => annotation.images ?? [],
    )) {
      const old = previousImages.get(image.id);
      if (old && !isDeepStrictEqual(old, image))
        throw new StoreError(409, 'Use a new image ID when replacing an attachment');
    }
    if (!previous && this.sessions.size >= MAX_SESSIONS)
      throw new StoreError(409, 'Session capacity reached');
    if (isDeepStrictEqual(previous, session)) return;
    const next = new Map(this.sessions).set(session.document.id, session);
    if (this.filePath !== undefined) {
      await writeSnapshot(
        this.filePath,
        { ...this.snapshot(), sessions: [...next.values()] },
        this.snapshot(),
      );
      this.stamp = await this.fileStamp();
    }
    this.sessions = next;
    const retained = new Set(
      session.document.annotations
        .flatMap((annotation) => annotation.images ?? [])
        .map((image) => image.id),
    );
    for (const image of previous?.document.annotations.flatMap(
      (annotation) => annotation.images ?? [],
    ) ?? []) {
      if (!preserveImages && !retained.has(image.id)) {
        this.images.delete(`${session.document.id}/${image.id}`);
        if (this.filePath)
          await rm(this.imagePath(session.document.id, image.id), { force: true }).catch(() => {});
      }
    }
    if (!isDeepStrictEqual(previous?.document, session.document)) {
      for (const listener of this.listeners.get(session.document.id) ?? []) {
        // Observers cannot turn a successfully persisted mutation into a failure.
        try {
          listener();
        } catch {
          /* Isolate disconnected observers. */
        }
      }
    }
  }

  async sync(sessionId: string, input: SyncRequest, requestOrigin: string): Promise<SyncResponse> {
    z.uuid().parse(sessionId);
    const request = SyncRequestSchema.parse(input);
    if (request.document.id !== sessionId)
      throw new StoreError(400, 'Session ID does not match document');
    if (documentOrigin(request.document) !== requestOrigin)
      throw new StoreError(403, 'Document origin does not match request');
    return this.mutate(async () => {
      const previous = this.sessions.get(sessionId);
      if (
        previous &&
        (previous.origin !== requestOrigin || previous.document.url !== request.document.url)
      ) {
        throw new StoreError(409, 'Session is bound to another document');
      }
      const revision =
        previous && createHash('sha256').update(JSON.stringify(previous)).digest('hex');
      const resolving = request.recovery && previous;
      if (
        resolving &&
        (request.recovery!.epoch !== this.storageEpoch || request.recovery!.revision !== revision)
      )
        throw new StoreError(
          409,
          'Recovery version changed. Retry to review the current server snapshot.',
          'recovery-stale',
        );
      if (
        previous &&
        request.storageEpoch &&
        request.storageEpoch !== this.storageEpoch &&
        (!isDeepStrictEqual(previous.document, request.document) ||
          request.operations.length > 0) &&
        !resolving
      ) {
        await this.preserveRecovery(request.document);
        return SyncResponseSchema.parse({
          document: previous.document,
          acknowledged: [],
          storageEpoch: this.storageEpoch,
          recovery: { revision },
        });
      }
      if (resolving) {
        await this.preserveRecovery(previous.document);
        await this.preserveRecovery(request.document);
      }
      const session: Session = previous
        ? structuredClone(previous)
        : {
            document: request.document,
            origin: requestOrigin,
            seen: [],
            tombstones: [],
          };
      if (resolving && request.recovery!.source === 'browser') {
        session.document = request.document;
        session.tombstones = session.tombstones.filter(
          (id) => !request.document.annotations.some((annotation) => annotation.id === id),
        );
      }
      validateSession(session);
      const seen = new Set(session.seen);
      const tombstones = new Set(session.tombstones);
      for (const operation of resolving ? [] : request.operations) {
        if (seen.has(operation.id)) continue;
        if (seen.size >= MAX_OPERATION_IDS) throw new StoreError(409, 'Operation capacity reached');
        const id = operation.kind === 'upsert' ? operation.annotation.id : operation.annotationId;
        if (operation.kind === 'delete') {
          if (!tombstones.has(id) && tombstones.size >= MAX_OPERATION_IDS)
            throw new StoreError(409, 'Tombstone capacity reached');
          tombstones.add(id);
        }
        if (operation.kind !== 'upsert' || !tombstones.has(id)) {
          const old = session.document.annotations.find((annotation) => annotation.id === id);
          const next = applyFeedbackOperation(session.document, operation);
          const annotation = next.annotations.find((item) => item.id === id);
          if (annotation && old) {
            // Ignore browser timestamps when deciding whether an edit is effective.
            annotation.updatedAt = old.updatedAt;
            if (!isDeepStrictEqual(annotation, old)) {
              annotation.updatedAt = new Date(
                Math.max(Date.now(), Date.parse(old.updatedAt) + 1),
              ).toISOString();
            }
          }
          session.document = next;
        }
        seen.add(operation.id);
      }
      session.seen = [...seen];
      if (resolving) {
        session.seen = [
          ...new Set([...session.seen, ...request.operations.map((operation) => operation.id)]),
        ];
        if (session.seen.length > MAX_OPERATION_IDS)
          throw new StoreError(409, 'Operation capacity reached');
      }
      session.tombstones = [...tombstones];
      await this.commit(session, !!resolving);
      const response = SyncResponseSchema.parse({
        document: session.document,
        acknowledged: request.operations.map((operation) => operation.id),
        storageEpoch: this.storageEpoch,
        missingImages: await this.missingImages(session.document),
      });
      return response;
    });
  }

  async createAnnotation(
    sessionId: string,
    input: CreateAnnotationInput,
  ): Promise<FeedbackDocument> {
    z.uuid().parse(sessionId);
    const content = CreateAnnotationSchema.parse(input);
    return this.mutate(async () => {
      const document = this.get(sessionId);
      const session = this.sessions.get(sessionId)!;
      if (content.page.url !== document.url)
        throw new StoreError(400, 'Annotation page URL must match document URL');
      if (session.tombstones.includes(content.id))
        throw new StoreError(409, 'Annotation ID was deleted');
      const existing = document.annotations.find((annotation) => annotation.id === content.id);
      if (existing) {
        if (
          existing.comment !== content.comment ||
          !isDeepStrictEqual(existing.page, content.page) ||
          !isDeepStrictEqual(existing.targets, content.targets)
        ) {
          throw new StoreError(409, 'Annotation ID already exists with different content');
        }
        return document;
      }
      const now = new Date().toISOString();
      document.annotations.push({
        ...content,
        createdAt: now,
        updatedAt: now,
        status: 'pending',
        replies: [],
      });
      await this.commit({ ...session, document });
      return structuredClone(document);
    });
  }

  async updateAnnotation(
    sessionId: string,
    annotationId: string,
    input: AnnotationPatch,
  ): Promise<FeedbackDocument> {
    z.uuid().parse(sessionId);
    z.uuid().parse(annotationId);
    const patch = AnnotationPatchSchema.parse(input);
    return this.mutate(async () => {
      const document = this.get(sessionId);
      const annotation = document.annotations.find((item) => item.id === annotationId);
      if (!annotation) throw new StoreError(404, 'Annotation not found in session');
      if (patch.page !== undefined && patch.page.url !== document.url)
        throw new StoreError(400, 'Annotation page URL must match document URL');
      const before = structuredClone(annotation);
      if (patch.comment !== undefined) annotation.comment = patch.comment;
      if (patch.page !== undefined) annotation.page = patch.page;
      if (patch.targets !== undefined) annotation.targets = patch.targets;
      if (isDeepStrictEqual(annotation, before)) return document;
      annotation.updatedAt = new Date(
        Math.max(Date.now(), Date.parse(before.updatedAt) + 1),
      ).toISOString();
      await this.commit({ ...this.sessions.get(sessionId)!, document });
      return structuredClone(document);
    });
  }

  async deleteAnnotation(sessionId: string, annotationId: string): Promise<FeedbackDocument> {
    z.uuid().parse(sessionId);
    z.uuid().parse(annotationId);
    return this.mutate(async () => {
      const document = this.get(sessionId);
      const session = this.sessions.get(sessionId)!;
      if (session.tombstones.includes(annotationId)) return document;
      const index = document.annotations.findIndex((annotation) => annotation.id === annotationId);
      if (index === -1) throw new StoreError(404, 'Annotation not found in session');
      if (session.tombstones.length >= MAX_OPERATION_IDS)
        throw new StoreError(409, 'Tombstone capacity reached');
      document.annotations.splice(index, 1);
      await this.commit({
        ...session,
        document,
        tombstones: [...session.tombstones, annotationId],
      });
      return structuredClone(document);
    });
  }

  async action(
    sessionId: string,
    annotationId: string,
    input: AgentAction,
  ): Promise<FeedbackDocument> {
    z.uuid().parse(sessionId);
    z.uuid().parse(annotationId);
    const action = AgentActionSchema.parse(input);
    return this.mutate(async () => {
      const document = this.get(sessionId);
      const annotation = document.annotations.find((item) => item.id === annotationId);
      if (!annotation) throw new StoreError(404, 'Annotation not found in session');
      const before = structuredClone(annotation);
      const message =
        action.kind === 'reply'
          ? action.message
          : action.kind === 'dismiss'
            ? action.reason
            : action.summary;
      const now = new Date(
        Math.max(Date.now(), Date.parse(annotation.updatedAt) + 1),
      ).toISOString();
      if (message !== undefined)
        annotation.replies.push({ id: randomUUID(), role: 'agent', message, createdAt: now });
      if (action.kind !== 'reply') {
        annotation.status =
          action.kind === 'acknowledge'
            ? 'acknowledged'
            : action.kind === 'resolve'
              ? 'resolved'
              : 'dismissed';
      }
      if (!isDeepStrictEqual(annotation, before)) annotation.updatedAt = now;
      const session = this.sessions.get(sessionId)!;
      await this.commit({ ...session, document });
      return structuredClone(document);
    });
  }
}

export async function createFeedbackStore(
  options: { filePath?: string } = {},
): Promise<FeedbackStore> {
  if (options.filePath === undefined) return new FeedbackStore();
  const { value, recovered } = await readSnapshot(options.filePath, parseFeedbackFile);
  const store = new FeedbackStore(
    options.filePath,
    value?.sessions,
    recovered ? randomUUID() : value?.storageEpoch,
  );
  await store.repair(!value?.storageEpoch || recovered);
  return store;
}

export function parseFeedbackFile(value: unknown) {
  const file = FileSchema.parse(value);
  file.sessions.forEach(validateSession);
  return file;
}
