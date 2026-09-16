import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { StoreError } from './store';

export const MAX_BODY_BYTES = 1024 * 1024;

export function tokenDigest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}
export function matchesToken(authorization: string | undefined, expected: string): boolean {
  return timingSafeEqual(tokenDigest(authorization ?? ''), tokenDigest(`Bearer ${expected}`));
}
export function isExactOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
  } catch {
    return false;
  }
}
export function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}
export function sendError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status =
    error instanceof StoreError ? error.status : error instanceof z.ZodError ? 400 : 500;
  sendJson(response, status, {
    code:
      error instanceof StoreError
        ? error.code
        : error instanceof Error &&
            'code' in error &&
            ['ENOSPC', 'EACCES', 'EPERM', 'EROFS'].includes(String(error.code))
          ? 'storage-unavailable'
          : error instanceof Error && 'code' in error && error.code === 'AINOTATION_STORAGE_DAMAGED'
            ? 'storage-damaged'
            : undefined,
    error:
      error instanceof StoreError
        ? error.message
        : status === 400
          ? 'Invalid request'
          : 'Internal server error',
  });
}
export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '') ||
    request.headers['content-encoding']
  )
    throw new StoreError(415, 'Expected unencoded application/json');
  if (Number(request.headers['content-length']) > MAX_BODY_BYTES)
    throw new StoreError(413, 'Request too large');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > MAX_BODY_BYTES) {
      request.resume();
      throw new StoreError(413, 'Request too large');
    }
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new StoreError(400, 'Invalid JSON');
  }
}
