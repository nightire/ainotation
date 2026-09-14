import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
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

  constructor(
    private readonly filePath?: string,
    sessions: Session[] = [],
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

  private async commit(session: Session): Promise<void> {
    validateSession(session);
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
      const parent = dirname(this.filePath);
      await mkdir(parent, { recursive: true, mode: 0o700 });
      const temporary = `${this.filePath}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify({ version: 1, sessions: [...next.values()] }), {
          mode: 0o600,
          flag: 'wx',
        });
        await rename(temporary, this.filePath);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
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
      if (!retained.has(image.id)) {
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
      const session: Session = previous
        ? structuredClone(previous)
        : {
            document: request.document,
            origin: requestOrigin,
            seen: [],
            tombstones: [],
          };
      validateSession(session);
      const seen = new Set(session.seen);
      const tombstones = new Set(session.tombstones);
      for (const operation of request.operations) {
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
      session.tombstones = [...tombstones];
      const response = SyncResponseSchema.parse({
        document: session.document,
        acknowledged: request.operations.map((operation) => operation.id),
      });
      await this.commit(session);
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
  let contents: string;
  try {
    contents = await readFile(options.filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return new FeedbackStore(options.filePath);
    throw error;
  }
  const data = FileSchema.parse(JSON.parse(contents));
  return new FeedbackStore(options.filePath, data.sessions);
}
