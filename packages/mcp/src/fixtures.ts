import { randomUUID } from 'node:crypto';
import { type Annotation, type FeedbackDocument } from '@ainotation/schema';

export const origin = 'http://127.0.0.1:5173';
export const testToken = 'ainotation-test-only-token';

export function fixture(url = `${origin}/page`): FeedbackDocument {
  const createdAt = '2026-01-01T00:00:00.000Z';
  const annotation: Annotation = {
    id: randomUUID(),
    comment: 'Keep all target context',
    createdAt,
    updatedAt: createdAt,
    status: 'pending',
    replies: [],
    page: {
      url,
      title: 'Fixture',
      viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 10, scrollY: 20 },
    },
    targets: [
      {
        id: randomUUID(),
        selector: '#target',
        shadowHosts: ['test-host'],
        tagName: 'button',
        text: 'Submit',
        attributes: { 'aria-label': 'Submit form' },
        styles: { color: 'red' },
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ],
  };
  return { schemaVersion: 1, id: randomUUID(), url, createdAt, annotations: [annotation] };
}
