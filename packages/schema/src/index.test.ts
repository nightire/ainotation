import { describe, expect, it } from 'vite-plus/test';
import { createFeedbackDocument, FeedbackDocumentSchema, feedbackJsonSchema } from './index';

describe('feedback contract', () => {
  it('creates an independent serializable document', () => {
    const document = createFeedbackDocument('http://localhost:5173');
    expect(FeedbackDocumentSchema.parse(JSON.parse(JSON.stringify(document)))).toEqual(document);
    expect(document.annotations).toEqual([]);
    expect(createFeedbackDocument(document.url).id).not.toBe(document.id);
  });

  it('rejects unsupported schema versions and invalid annotations', () => {
    const document = createFeedbackDocument('http://localhost:5173');
    expect(FeedbackDocumentSchema.safeParse({ ...document, schemaVersion: 2 }).success).toBe(false);
    expect(
      FeedbackDocumentSchema.safeParse({ ...document, annotations: [{ comment: '' }] }).success,
    ).toBe(false);
    expect(() => createFeedbackDocument('not a URL')).toThrow();
  });

  it('emits the same contract as JSON Schema', () => {
    expect(feedbackJsonSchema()).toMatchObject({
      type: 'object',
      properties: { schemaVersion: { const: 1 }, annotations: { type: 'array' } },
    });
  });
});
