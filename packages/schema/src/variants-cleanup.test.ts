import { expect, it } from 'vite-plus/test';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  createVariantExploration,
  transitionVariants,
  feedbackExport,
  type VariantAction,
} from './index';

it.each(['requested', 'published', 'accepted', 'cancelled', 'completed'] as const)(
  'deleting a %s exploration preserves exactly the necessary cleanup state',
  (status) => {
    const document = createFeedbackDocument('http://localhost/cleanup');
    const target = {
      id: crypto.randomUUID(),
      selector: '#target',
      tagName: 'button',
      text: 'Original',
      shadowHosts: [],
      attributes: {},
      styles: {},
      rect: { x: 0, y: 0, width: 100, height: 30 },
    };
    const id = crypto.randomUUID();
    let state = createVariantExploration(crypto.randomUUID(), [target.id]);
    const advance = (action: VariantAction) => {
      state = transitionVariants(state, {
        id: crypto.randomUUID(),
        kind: 'variants',
        annotationId: id,
        explorationId: state.id,
        generation: state.generation,
        revision: state.revision,
        action,
      })!;
    };
    if (status !== 'requested')
      advance({ type: 'publish', choices: [{ id: 'bold', label: 'Bold' }] });
    if (status === 'accepted' || status === 'completed')
      advance({ type: 'accept', variantId: 'bold', feedback: 'Keep bold' });
    if (status === 'cancelled') advance({ type: 'cancel', feedback: 'Back to original' });
    if (status === 'completed')
      advance({
        type: 'complete',
        decisionId: state.decision!.id,
        summary: 'Applied and cleaned up.',
      });
    const note = {
      id,
      comment: 'Try alternatives',
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
      targets: [target],
      variants: state,
      page: {
        url: document.url,
        title: 'Test',
        viewport: { width: 800, height: 600, scrollX: 0, scrollY: 0, devicePixelRatio: 1 },
      },
      status: 'pending' as const,
      replies: [],
    };
    document.annotations.push(note);
    const operation = { id: crypto.randomUUID(), kind: 'delete' as const, annotationId: id };
    const deleted = applyFeedbackOperation(document, operation);
    expect(deleted.annotations).toEqual([]);
    if (status === 'completed') expect(deleted.variantCleanups).toBeUndefined();
    else {
      const cleanup = deleted.variantCleanups![0]!;
      expect(cleanup.variants).toMatchObject({
        id: state.id,
        generation: state.generation,
        status: 'cancelled',
        decision: { kind: 'cancel' },
      });
      expect(cleanup.variants.manifest).toEqual(state.manifest);
      expect(cleanup.variants.decision!.id).toBe(
        status === 'cancelled' ? state.decision!.id : operation.id,
      );
      expect(cleanup.targets).toEqual(note.targets);
      expect(feedbackExport(deleted).variantCleanups).toEqual(deleted.variantCleanups);
      expect(applyFeedbackOperation(deleted, operation)).toEqual(deleted);
      expect(
        applyFeedbackOperation(deleted, {
          id: crypto.randomUUID(),
          kind: 'upsert',
          annotation: note,
        }).annotations,
      ).toEqual([]);
      expect(() =>
        applyFeedbackOperation(deleted, {
          id: crypto.randomUUID(),
          kind: 'upsert',
          annotation: { ...note, id: crypto.randomUUID(), variants: undefined },
          variantRequest: crypto.randomUUID(),
        }),
      ).toThrow('Another annotation already owns');
    }
    expect(document.annotations[0]!.variants).toEqual(state);
  },
);
