import { MAX_IMAGE_BYTES, type FeedbackDocument } from '@ainotation/schema';
import type { McpConnection } from './sync';
import { verifyImage } from './images';
import { uiError } from '../i18n';

export async function syncImages(options: {
  document: FeedbackDocument;
  local: Record<string, Blob>;
  connection: McpConnection;
  signal: AbortSignal;
  uploaded: Set<string>;
  missing?: string[];
}): Promise<Record<string, Blob>> {
  const blobs: Record<string, Blob> = {};
  const { connection, signal, uploaded } = options;
  const images = new Map(
    options.document.annotations
      .flatMap((annotation) => annotation.images ?? [])
      .map((image) => [image.id, image]),
  );
  const keyFor = (id: string, sha256: string) =>
    `${connection.endpoint}:${connection.token}:${options.document.id}:${id}:${sha256}`;
  const activeKeys = new Set([...images.values()].map((image) => keyFor(image.id, image.sha256)));
  for (const key of uploaded) if (!activeKeys.has(key)) uploaded.delete(key);
  for (const image of images.values()) {
    const key = keyFor(image.id, image.sha256);
    const local = options.local[image.id];
    if (local && uploaded.has(key) && !options.missing?.includes(image.id)) continue;
    if (local) await verifyImage(local, image);
    const response = await fetch(
      `${connection.endpoint}/sessions/${options.document.id}/images/${image.id}`,
      {
        method: local ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${connection.token}`,
          ...(local ? { 'Content-Type': 'image/png' } : {}),
        },
        ...(local ? { body: local } : {}),
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 404 && !local) throw uiError('syncImagesMissing');
      throw new Error(`Image synchronization failed (${response.status}).`);
    }
    if (local) {
      await response.body?.cancel();
      uploaded.add(key);
      continue;
    }
    if (!response.body || response.headers.get('Content-Type') !== 'image/png') {
      await response.body?.cancel();
      throw new Error('Invalid image response.');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > MAX_IMAGE_BYTES) throw new Error('Image response too large.');
        chunks.push(new Uint8Array(next.value));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const blob = new Blob(chunks, { type: 'image/png' });
    await verifyImage(blob, image);
    blobs[image.id] = blob;
    uploaded.add(key);
  }
  return blobs;
}
