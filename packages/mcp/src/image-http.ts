import type { IncomingMessage, ServerResponse } from 'node:http';
import { MAX_IMAGE_BYTES } from '@ainotation/schema';
import { z } from 'zod';
import { StoreError, type FeedbackStore } from './store';

export async function imageHttp(
  request: IncomingMessage,
  response: ServerResponse,
  scope: () => Promise<{ store: FeedbackStore; origin?: string }>,
): Promise<boolean> {
  const match = /^\/sessions\/([^/]+)\/images\/([^/]+)$/.exec(request.url ?? '');
  if (!match) return false;
  const session = z.uuid().parse(match[1]),
    image = z.uuid().parse(match[2]);
  let current = await scope();
  current.store.image(session, image, current.origin);
  if (request.method === 'GET') {
    const bytes = await current.store.getImage(session, image, current.origin);
    current = await scope();
    current.store.image(session, image, current.origin);
    response.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': bytes.length });
    response.end(bytes);
  } else if (request.method === 'POST' && current.origin) {
    if (request.headers['content-type'] !== 'image/png' || request.headers['content-encoding'])
      throw new StoreError(415, 'Expected unencoded image/png');
    if (Number(request.headers['content-length']) > MAX_IMAGE_BYTES)
      throw new StoreError(413, 'Image too large');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > MAX_IMAGE_BYTES) {
        request.resume();
        throw new StoreError(413, 'Image too large');
      }
      chunks.push(bytes);
    }
    current = await scope();
    if (!current.origin) throw new StoreError(403, 'Browser connection required');
    await current.store.putImage(session, image, Buffer.concat(chunks), current.origin);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end('{}');
  } else throw new StoreError(405, 'Method not allowed');
  return true;
}
