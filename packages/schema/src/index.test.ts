import { describe, expect, it } from 'vite-plus/test';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  FeedbackDocumentSchema,
  feedbackJsonSchema,
  feedbackMarkdown,
  feedbackExport,
  feedbackExportJsonSchema,
} from './index';
import type { Annotation } from './index';

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

  it('preserves agent state on human edits and serializes full target context', () => {
    const document = createFeedbackDocument('http://localhost:5173');
    const time = new Date().toISOString();
    const annotation: Annotation = {
      id: crypto.randomUUID(),
      comment: 'Move this button',
      createdAt: time,
      updatedAt: time,
      page: {
        url: document.url,
        title: 'Example',
        viewport: { width: 800, height: 600, devicePixelRatio: 2, scrollX: 0, scrollY: 10 },
      },
      targets: [
        {
          id: crypto.randomUUID(),
          selector: '#submit',
          shadowHosts: [],
          tagName: 'button',
          text: 'Submit',
          attributes: { id: 'submit' },
          rect: { x: 10, y: 20, width: 100, height: 40 },
          styles: { color: 'red' },
        },
      ],
      marker: { x: 25, y: 45, space: 'document' },
      status: 'resolved',
      replies: [{ id: crypto.randomUUID(), role: 'agent', message: 'Aligned', createdAt: time }],
    };
    document.annotations.push(annotation);
    annotation.targets[0]!.ancestors = [{ tagName: 'main', attributes: { id: 'checkout' } }];
    annotation.targets[0]!.nearbyText = { before: 'Order summary', after: 'Shipping details' };
    annotation.targets[0]!.textSelection = {
      exact: 'Submit',
      prefix: 'Please ',
      suffix: ' now',
      truncated: false,
      rects: [],
    };
    const next = applyFeedbackOperation(document, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: {
        ...annotation,
        status: 'pending',
        replies: [],
        comment: 'Also check narrow widths',
      },
    });
    expect(next.annotations[0]?.status).toBe('resolved');
    expect(next.annotations[0]?.replies).toEqual(annotation.replies);
    const markdown = feedbackMarkdown(next, { detail: 'forensic' });
    expect(markdown).toContain(annotation.id);
    expect(markdown).toContain('#submit');
    expect(markdown).toContain('red');
    expect(markdown).toContain('Marker anchor:');
    expect(markdown).not.toContain('Aligned');
    expect(markdown).not.toContain('resolved');
    expect(feedbackMarkdown(next, { includeConversation: true })).toContain('Aligned');
    expect(markdown).toContain('narrow widths');
    expect(document.annotations[0]?.comment).toBe('Move this button');
    const exported = feedbackExport(next);
    expect(exported.annotations[0]).not.toHaveProperty('replies');
    expect(exported.annotations[0]).not.toHaveProperty('status');
    expect(exported.annotations[0]?.targets).toEqual(annotation.targets);
    expect(exported.annotations[0]?.marker).toEqual(annotation.marker);
    expect(next.annotations[0]?.replies).toEqual(annotation.replies);
    expect(JSON.stringify(feedbackExportJsonSchema())).not.toContain('replies');
    expect(JSON.stringify(feedbackExportJsonSchema())).not.toContain('status');
    const before = structuredClone(next);
    const compact = feedbackMarkdown(next, { detail: 'compact' });
    const standard = feedbackMarkdown(next);
    const detailed = feedbackMarkdown(next, { detail: 'detailed' });
    expect(compact).toContain('Submit');
    expect(compact).not.toContain('Viewport:');
    expect(standard).toContain('Selected text:');
    expect(standard).not.toContain('Bounds (viewport px):');
    expect(detailed).toContain('Bounds (viewport px):');
    expect(detailed).toContain('Selection context:');
    expect(detailed).not.toContain('Styles at annotation:');
    expect(markdown).toContain('DOM path:');
    expect(markdown).toContain('checkout');
    expect(next).toEqual(before);
  });
});
