import { expect, it, vi } from 'vite-plus/test';
import { MAX_IMAGE_BYTES } from '@ainotation/schema';
import { readImageResponse } from './image-response';

it('bounds chunked image downloads before buffering the full response', async () => {
  const cancelled = vi.fn();
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_IMAGE_BYTES));
        controller.enqueue(new Uint8Array(1));
      },
      cancel: cancelled,
    }),
    { headers: { 'Content-Type': 'image/png' } },
  );
  await expect(readImageResponse(response)).rejects.toThrow('too large');
  expect(cancelled).toHaveBeenCalledOnce();
  expect(response.body?.locked).toBe(false);
});

it('returns bounded PNG bytes and rejects failed or unexpected responses', async () => {
  const bytes = Buffer.from([1, 2, 3]);
  expect(
    await readImageResponse(new Response(bytes, { headers: { 'Content-Type': 'image/png' } })),
  ).toEqual(bytes);
  await expect(readImageResponse(new Response('missing', { status: 404 }))).rejects.toMatchObject({
    status: 404,
  });
  await expect(readImageResponse(new Response('not png'))).rejects.toMatchObject({ status: 502 });
});
