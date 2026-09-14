import { MAX_IMAGE_BYTES } from '@ainotation/schema';
import { StoreError } from './store';

/** Enforce the byte limit while reading, including responses without Content-Length. */
export async function readImageResponse(response: Response): Promise<Buffer> {
  if (
    !response.ok ||
    response.headers.get('content-type') !== 'image/png' ||
    Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES ||
    !response.body
  ) {
    await response.body?.cancel();
    throw new StoreError(response.ok ? 502 : response.status, 'Image attachment unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_IMAGE_BYTES) throw new StoreError(502, 'Image response too large');
      chunks.push(chunk.value);
    }
    return Buffer.concat(chunks, size);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
