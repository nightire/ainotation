import {
  FeedbackImageSchema,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  type FeedbackImage,
} from '@ainotation/schema';
import { cropPixels, type ImageCrop } from './crop';
import { uiError } from '../i18n';

export async function imageDigest(blob: Blob): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw uiError('invalidDimensions', width, height);
}

export function checkImageSize(width: number, height: number) {
  validDimensions(width, height);
  if (width > 16384 || height > 16384 || width * height > MAX_IMAGE_PIXELS)
    throw uiError('imageTooLarge', width, height);
}

export function fittedImageSize(width: number, height: number) {
  validDimensions(width, height);
  const ratio = Math.min(
    1,
    16384 / width,
    16384 / height,
    Math.sqrt(MAX_IMAGE_PIXELS / (width * height)),
  );
  return {
    width: Math.max(1, Math.floor(width * ratio)),
    height: Math.max(1, Math.floor(height * ratio)),
  };
}

/** Allocate only the bounded output bitmap, including for high-resolution capture frames. */
export function imageCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
  crop?: ImageCrop,
) {
  const region = crop ? cropPixels(crop, width, height) : null;
  const size = fittedImageSize(region?.width ?? width, region?.height ?? height);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  try {
    const context = canvas.getContext('2d');
    if (!context) throw uiError('drawingUnavailable');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    if (region)
      context.drawImage(
        source,
        region.x,
        region.y,
        region.width,
        region.height,
        0,
        0,
        size.width,
        size.height,
      );
    else context.drawImage(source, 0, 0, size.width, size.height);
    return canvas;
  } catch (error) {
    canvas.width = 0;
    canvas.height = 0;
    throw error;
  }
}

/** PNG has no lossy quality knob. Reduce dimensions only when an output limit requires it. */
export async function canvasBlob(canvas: HTMLCanvasElement, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted();
  const size = fittedImageSize(canvas.width, canvas.height);
  let output = canvas;
  try {
    if (size.width !== canvas.width || size.height !== canvas.height)
      output = imageCanvas(canvas, size.width, size.height);
    while (true) {
      signal?.throwIfAborted();
      const blob = await new Promise<Blob>((resolve, reject) =>
        output.toBlob((blob) => {
          if (!blob) reject(uiError('encodeFailed', output.width, output.height));
          else resolve(blob);
        }, 'image/png'),
      );
      signal?.throwIfAborted();
      if (blob.size <= MAX_IMAGE_BYTES) return blob;
      if (output.width === 1 && output.height === 1) throw uiError('imageFitFailed');
      const ratio = Math.min(0.85, Math.sqrt(MAX_IMAGE_BYTES / blob.size) * 0.9);
      const width = Math.max(1, Math.floor(output.width * ratio));
      const height = Math.max(1, Math.floor(output.height * ratio));
      if (output !== canvas) {
        output.width = 0;
        output.height = 0;
      }
      // Resample from the original to avoid accumulating blur across retries.
      output = imageCanvas(canvas, width, height);
    }
  } finally {
    if (output !== canvas) {
      output.width = 0;
      output.height = 0;
    }
  }
}

export async function decodeImage(blob: Blob): Promise<ImageBitmap> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(blob.type)) throw uiError('imageType');
  if (blob.size > MAX_IMAGE_BYTES) throw uiError('imageBytesLimit');
  const bitmap = await createImageBitmap(blob);
  try {
    checkImageSize(bitmap.width, bitmap.height);
  } catch (error) {
    bitmap.close();
    throw error;
  }
  return bitmap;
}

export async function describeImage(
  blob: Blob,
  source: FeedbackImage['source'],
): Promise<FeedbackImage> {
  const bitmap = await decodeImage(blob);
  try {
    return FeedbackImageSchema.parse({
      id: crypto.randomUUID(),
      mimeType: 'image/png',
      width: bitmap.width,
      height: bitmap.height,
      size: blob.size,
      sha256: await imageDigest(blob),
      source,
    });
  } finally {
    bitmap.close();
  }
}

export async function verifyImage(blob: Blob, image: FeedbackImage): Promise<void> {
  if (
    blob.type !== image.mimeType ||
    blob.size !== image.size ||
    (await imageDigest(blob)) !== image.sha256
  )
    throw uiError('imageValidation');
}
