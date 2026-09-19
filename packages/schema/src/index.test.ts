import { describe, expect, it } from 'vite-plus/test';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  FeedbackDocumentSchema,
  feedbackJsonSchema,
  feedbackMarkdown,
  feedbackExport,
  feedbackExportJsonSchema,
  FeedbackImagesSchema,
  StyleChangesSchema,
  normalizeSharedStyles,
} from './index';
import type { Annotation } from './index';

describe('feedback contract', () => {
  it('keeps canonical target styles shared across marker mutations and removes only the last reference', () => {
    const document = createFeedbackDocument('http://localhost/shared');
    const target = {
      id: crypto.randomUUID(),
      selector: '#same',
      shadowHosts: [],
      tagName: 'button',
      text: 'Same',
      attributes: {},
      styles: {},
      rect: { x: 0, y: 0, width: 20, height: 20 },
    };
    const note = (id: string): Annotation => ({
      id,
      comment: id,
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
      page: {
        url: document.url,
        title: 'Shared',
        viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      },
      targets: [target],
      status: 'pending',
      replies: [],
    });
    const a = note(crypto.randomUUID()),
      b = note(crypto.randomUUID());
    document.annotations = [a, b];
    const update = (value: string) => ({
      ...a,
      targets: [
        { ...target, styleChanges: [{ property: 'padding-top' as const, before: '8px', value }] },
      ],
    });
    let next = applyFeedbackOperation(document, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: update('20px'),
    });
    expect(Object.keys(next.targetStyles!)).toEqual([target.id]);
    expect(next.annotations.map((item) => item.targets[0]!.styleChanges?.[0]?.value)).toEqual([
      '20px',
      '20px',
    ]);
    next.annotations[1]!.targets[0]!.styleChanges![0]!.value = '999px';
    next = normalizeSharedStyles(next);
    expect(next.annotations[1]!.targets[0]!.styleChanges![0]!.value).toBe('20px');
    next = applyFeedbackOperation(next, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: { ...b, targets: [{ ...target, styleChanges: [] }] },
    });
    expect(next.targetStyles).toBeUndefined();
    expect(next.annotations.every((item) => !item.targets[0]!.styleChanges)).toBe(true);
    next = applyFeedbackOperation(next, {
      id: crypto.randomUUID(),
      kind: 'upsert',
      annotation: update('24px'),
    });
    next = applyFeedbackOperation(next, {
      id: crypto.randomUUID(),
      kind: 'delete',
      annotationId: a.id,
    });
    expect(next.targetStyles![target.id]![0]!.value).toBe('24px');
    next = applyFeedbackOperation(next, {
      id: crypto.randomUUID(),
      kind: 'delete',
      annotationId: b.id,
    });
    expect(next.targetStyles).toBeUndefined();
  });
  it('merges legacy non-overlapping declarations without trusting stale inline projections', () => {
    const doc = createFeedbackDocument('http://localhost/legacy');
    const id = crypto.randomUUID();
    const target = {
      id,
      selector: 'button',
      shadowHosts: [],
      tagName: 'button',
      text: '',
      attributes: {},
      styles: {},
      rect: { x: 0, y: 0, width: 20, height: 20 },
    };
    const note = (value: Annotation['targets'][number]['styleChanges']): Annotation => ({
      id: crypto.randomUUID(),
      comment: 'legacy',
      createdAt: doc.createdAt,
      updatedAt: doc.createdAt,
      page: {
        url: doc.url,
        title: '',
        viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      },
      targets: [{ ...target, styleChanges: value }],
      status: 'pending',
      replies: [],
    });
    doc.annotations = [
      note([{ property: 'color', before: 'black', value: 'red' }]),
      note([{ property: 'font-size', before: '14px', value: '18px' }]),
    ];
    const migrated = normalizeSharedStyles(doc);
    expect(migrated.targetStyles![id]).toHaveLength(2);
    expect(migrated.annotations[0]!.targets[0]!.styleChanges).toEqual(
      migrated.annotations[1]!.targets[0]!.styleChanges,
    );
  });
  it('validates bounded literal style suggestions and rejects duplicates', () => {
    const change = { property: 'padding-top', before: '8px', value: '12px' };
    expect(StyleChangesSchema.parse([change])).toEqual([change]);
    for (const invalid of [
      [change, change],
      [{ ...change, property: 'background-image' }],
      [{ ...change, value: 'url(https://example.com)' }],
      [{ ...change, value: 'var(--x)' }],
      [{ ...change, value: '1px; color:red' }],
    ])
      expect(StyleChangesSchema.safeParse(invalid).success).toBe(false);
  });
  it('rejects oversized pixel dimensions and duplicate image IDs', () => {
    const image = {
      id: crypto.randomUUID(),
      mimeType: 'image/png',
      source: 'screen',
      width: 800,
      height: 600,
      size: 1234,
      sha256: '0'.repeat(64),
    };
    expect(FeedbackImagesSchema.safeParse([image]).success).toBe(true);
    expect(FeedbackImagesSchema.safeParse([image, image]).success).toBe(false);
    expect(FeedbackImagesSchema.safeParse([{ ...image, width: 8000, height: 8000 }]).success).toBe(
      false,
    );
  });
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
    annotation.targets[0]!.styleChanges = [
      { property: 'padding-top', before: '8px', value: '12px' },
    ];
    for (const detail of ['compact', 'standard', 'detailed', 'forensic'] as const) {
      const output = feedbackMarkdown(document, { detail });
      expect(output).toContain('padding-top: "8px" → "12px"');
      expect(output).toContain('recorded viewport');
    }
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
    expect(feedbackExportJsonSchema()).not.toHaveProperty(
      'properties.annotations.items.properties.status',
    );
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
