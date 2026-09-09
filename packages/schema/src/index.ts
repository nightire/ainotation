import { z } from 'zod';

export const FEEDBACK_SCHEMA_VERSION = 1;

export const AnnotationSchema = z.object({
  id: z.uuid(),
  comment: z.string().trim().min(1),
  createdAt: z.iso.datetime(),
});

export const FeedbackDocumentSchema = z.object({
  schemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
  id: z.uuid(),
  url: z.url(),
  createdAt: z.iso.datetime(),
  annotations: z.array(AnnotationSchema),
});

export type Annotation = z.infer<typeof AnnotationSchema>;
export type FeedbackDocument = z.infer<typeof FeedbackDocumentSchema>;

export function createFeedbackDocument(url: string): FeedbackDocument {
  return FeedbackDocumentSchema.parse({
    schemaVersion: FEEDBACK_SCHEMA_VERSION,
    id: crypto.randomUUID(),
    url,
    createdAt: new Date().toISOString(),
    annotations: [],
  });
}

export function feedbackJsonSchema() {
  return z.toJSONSchema(FeedbackDocumentSchema, { target: 'draft-2020-12' });
}
