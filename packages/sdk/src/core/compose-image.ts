import { canvasBlob, imageCanvas } from './images';
import { cropPixels, type ImageCrop } from './crop';

/** Render tool-owned SVG over an imported bitmap, releasing every temporary resource. */
export async function composeImage(
  bitmap: ImageBitmap,
  markup: string,
  crop: ImageCrop | undefined,
  signal: AbortSignal,
): Promise<Blob> {
  signal.throwIfAborted();
  const canvas = imageCanvas(bitmap, bitmap.width, bitmap.height, crop);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  const image = new Image();
  const bound = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  try {
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('Image composition stopped or timed out.'));
      if (bound.aborted) {
        abort();
        return;
      }
      bound.addEventListener('abort', abort, { once: true });
      void image
        .decode()
        .then(resolve, reject)
        .finally(() => bound.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image drawing is unavailable.');
    if (crop) {
      const region = cropPixels(crop, bitmap.width, bitmap.height);
      context.drawImage(
        image,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        canvas.width,
        canvas.height,
      );
    } else context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas, signal);
  } finally {
    image.src = '';
    URL.revokeObjectURL(url);
    canvas.width = 0;
    canvas.height = 0;
  }
}
