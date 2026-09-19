import { expect, it } from 'vite-plus/test';
import {
  createVariantExploration,
  transitionVariants,
  VariantChoicesSchema,
  VariantOperationSchema,
  type VariantAction,
  type VariantExploration,
} from './variants';

const operation = (state: VariantExploration, action: VariantAction) =>
  VariantOperationSchema.parse({
    id: crypto.randomUUID(),
    kind: 'variants',
    annotationId: crypto.randomUUID(),
    explorationId: state.id,
    revision: state.revision,
    generation: state.generation,
    action,
  });
it('keeps original separate, retains the previous generation and rejects stale decisions', () => {
  const initial = createVariantExploration(crypto.randomUUID(), [crypto.randomUUID()]);
  const publish = operation(initial, {
    type: 'publish',
    choices: [{ id: 'compact', label: 'Compact' }],
  });
  const ready = transitionVariants(initial, publish)!;
  expect(ready).toMatchObject({ status: 'published', revision: 2, generation: 1 });
  expect(transitionVariants(ready, publish)).toBeNull();
  expect(
    transitionVariants(
      ready,
      operation(ready, { type: 'accept', variantId: 'missing', feedback: '' }),
    ),
  ).toBeNull();
  const selectedOperation = operation(ready, {
    type: 'accept',
    variantId: 'compact',
    feedback: 'Use the compact spacing.',
  });
  const selected = transitionVariants(ready, selectedOperation)!;
  expect(selected.decision).toMatchObject({ id: selectedOperation.id, variantId: 'compact' });
  expect(
    transitionVariants(
      selected,
      operation(selected, {
        type: 'complete',
        decisionId: crypto.randomUUID(),
        summary: 'Not the same decision',
      }),
    ),
  ).toBeNull();
  const regenerated = transitionVariants(
    selected,
    operation(selected, { type: 'regenerate', feedback: 'Keep spacing, explore shapes.' }),
  )!;
  expect(regenerated).toMatchObject({
    status: 'requested',
    generation: 2,
    manifest: { generation: 1 },
    decision: { kind: 'regenerate', feedback: 'Keep spacing, explore shapes.' },
  });
  expect(transitionVariants(regenerated, selectedOperation)).toBeNull();
  const cancelled = transitionVariants(
    regenerated,
    operation(regenerated, { type: 'cancel', feedback: '' }),
  )!;
  const completed = transitionVariants(
    cancelled,
    operation(cancelled, {
      type: 'complete',
      decisionId: cancelled.decision!.id,
      summary: 'Original restored, candidates removed.',
    }),
  )!;
  expect(completed.status).toBe('completed');
  expect(initial).toMatchObject({ status: 'requested', revision: 1 });
});
it('validates bounded candidate identifiers and keeps readiness reports out of decision revisions', () => {
  expect(VariantChoicesSchema.safeParse([{ id: 'original', label: 'Original' }]).success).toBe(
    false,
  );
  expect(
    VariantChoicesSchema.safeParse([
      { id: 'a', label: 'A' },
      { id: 'a', label: 'Again' },
    ]).success,
  ).toBe(false);
  const state = createVariantExploration(crypto.randomUUID(), [crypto.randomUUID()]);
  const updated = transitionVariants(
    state,
    operation(state, {
      type: 'report',
      report: {
        clientId: crypto.randomUUID(),
        generation: 1,
        status: 'waiting',
        detail: 'missing',
        observedAt: new Date().toISOString(),
      },
    }),
  )!;
  expect(updated.revision).toBe(state.revision);
  expect(updated.report?.status).toBe('waiting');
  expect(updated.decision).toBeUndefined();
});
