import { z } from 'zod';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 16_777_216;
export const MAX_ANNOTATION_IMAGES = 8;

export const FeedbackImageSchema = z
  .object({
    id: z.uuid(),
    mimeType: z.literal('image/png'),
    width: z.number().int().positive().max(16384),
    height: z.number().int().positive().max(16384),
    size: z.number().int().positive().max(MAX_IMAGE_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.enum(['screen', 'import']),
  })
  .refine(
    (image) => image.width * image.height <= MAX_IMAGE_PIXELS,
    'Image exceeds the pixel limit',
  );
export const FeedbackImagesSchema = z
  .array(FeedbackImageSchema)
  .max(MAX_ANNOTATION_IMAGES)
  .refine(
    (images) => new Set(images.map((image) => image.id)).size === images.length,
    'Duplicate image attachment ID',
  );
export type FeedbackImage = z.infer<typeof FeedbackImageSchema>;

export function imageFilename(image: Pick<FeedbackImage, 'id'>): string {
  return `${image.id}.png`;
}
