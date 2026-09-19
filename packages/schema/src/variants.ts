import { z } from 'zod';

export const VARIANTS_PROTOCOL_VERSION = 1;
export const VARIANTS_CAPABILITIES = { uiVariants: 1 as const, uiVariantsCleanup: 1 as const };
export const ORIGINAL_VARIANT = 'original';
export const VariantIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const VariantChoicesSchema = z
  .array(
    z.object({
      id: VariantIdSchema,
      label: z.string().trim().min(1).max(80),
      description: z.string().max(500).optional(),
    }),
  )
  .min(1)
  .max(6)
  .refine(
    (choices) =>
      choices.every((choice) => choice.id !== ORIGINAL_VARIANT) &&
      new Set(choices.map((choice) => choice.id)).size === choices.length,
    'Candidates must have distinct IDs other than original.',
  );
export const VariantManifestSchema = z.object({
  generation: z.number().int().min(1).max(10000),
  choices: VariantChoicesSchema,
});
export const VariantReportSchema = z.object({
  clientId: z.uuid(),
  generation: z.number().int().positive(),
  status: z.enum(['waiting', 'ready', 'error']),
  detail: z.string().max(1000),
  observedAt: z.iso.datetime(),
});
export const VariantDecisionSchema = z.object({
  id: z.uuid(),
  generation: z.number().int().positive(),
  kind: z.enum(['accept', 'regenerate', 'cancel']),
  variantId: VariantIdSchema.optional(),
  feedback: z.string().trim().max(10000),
  createdAt: z.iso.datetime(),
});
export const VariantExplorationSchema = z
  .object({
    protocolVersion: z.literal(VARIANTS_PROTOCOL_VERSION),
    id: z.uuid(),
    revision: z.number().int().positive(),
    generation: z.number().int().min(1).max(10000),
    status: z.enum(['requested', 'published', 'accepted', 'cancelled', 'completed']),
    targetIds: z
      .array(z.uuid())
      .min(1)
      .max(20)
      .refine((ids) => new Set(ids).size === ids.length),
    defaultCount: z.literal(3),
    manifest: VariantManifestSchema.optional(),
    decision: VariantDecisionSchema.optional(),
    report: VariantReportSchema.optional(),
    completion: z
      .object({ decisionId: z.uuid(), summary: z.string().trim().min(1).max(2000) })
      .optional(),
  })
  .superRefine((value, context) => {
    const invalid = (message: string) => context.addIssue({ code: 'custom', message });
    if (value.manifest && value.manifest.generation > value.generation)
      invalid('A manifest cannot belong to a future generation.');
    if (
      ['published', 'accepted'].includes(value.status) &&
      value.manifest?.generation !== value.generation
    )
      invalid('Published explorations require a current manifest.');
    if (
      value.status === 'accepted' &&
      (value.decision?.kind !== 'accept' ||
        value.decision.generation !== value.generation ||
        ![ORIGINAL_VARIANT, ...(value.manifest?.choices.map((choice) => choice.id) ?? [])].includes(
          value.decision.variantId ?? '',
        ))
    )
      invalid('Acceptance requires a decision for a current candidate.');
    if (
      value.status === 'cancelled' &&
      (value.decision?.kind !== 'cancel' || value.decision.generation !== value.generation)
    )
      invalid('Cancellation requires a current user decision.');
    if (value.report && value.report.generation !== value.generation)
      invalid('A preview report must belong to the current generation.');
    if (
      value.status === 'completed' &&
      (!value.decision ||
        value.decision.kind === 'regenerate' ||
        value.completion?.decisionId !== value.decision.id)
    )
      invalid('Completion requires the exact accepted/cancelled decision.');
    if (value.status !== 'completed' && value.completion)
      invalid('Only completed explorations can have a completion report.');
  });
export type VariantExploration = z.infer<typeof VariantExplorationSchema>;
export type VariantManifest = z.infer<typeof VariantManifestSchema>;
export type VariantReport = z.infer<typeof VariantReportSchema>;

export const VariantActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('publish'), choices: VariantChoicesSchema }),
  z.object({
    type: z.literal('accept'),
    variantId: VariantIdSchema,
    feedback: z.string().trim().max(10000).default(''),
  }),
  z.object({ type: z.literal('regenerate'), feedback: z.string().trim().max(10000).default('') }),
  z.object({ type: z.literal('cancel'), feedback: z.string().trim().max(10000).default('') }),
  z.object({ type: z.literal('report'), report: VariantReportSchema }),
  z.object({
    type: z.literal('complete'),
    decisionId: z.uuid(),
    summary: z.string().trim().min(1).max(2000),
  }),
]);
export type VariantAction = z.infer<typeof VariantActionSchema>;
export const VariantOperationSchema = z.object({
  id: z.uuid(),
  kind: z.literal('variants'),
  annotationId: z.uuid(),
  explorationId: z.uuid(),
  revision: z.number().int().positive(),
  generation: z.number().int().positive(),
  action: VariantActionSchema,
});
export type VariantOperation = z.infer<typeof VariantOperationSchema>;

/** A restart must explicitly refer to the completed exploration it replaces. */
export function canStartVariantExploration(
  current: VariantExploration | undefined,
  requestId: string,
  previous: VariantExploration | undefined,
) {
  return (
    !current ||
    (current.status === 'completed' &&
      current.id !== requestId &&
      previous?.status === 'completed' &&
      previous.id === current.id &&
      previous.revision === current.revision)
  );
}

export function createVariantExploration(id: string, targetIds: string[]): VariantExploration {
  return VariantExplorationSchema.parse({
    protocolVersion: 1,
    id,
    revision: 1,
    generation: 1,
    status: 'requested',
    targetIds,
    defaultCount: 3,
  });
}
export const variantActive = (exploration: VariantExploration | undefined) =>
  !!exploration && exploration.status !== 'completed';

/** Compare-and-set transitions are shared by optimistic browser writes and the service. */
export function transitionVariants(
  current: VariantExploration,
  operation: VariantOperation,
): VariantExploration | null {
  const { action } = operation;
  if (
    current.id !== operation.explorationId ||
    current.revision !== operation.revision ||
    current.generation !== operation.generation
  )
    return null;
  const next = structuredClone(current);
  if (action.type === 'report') {
    if (
      !['requested', 'published'].includes(current.status) ||
      action.report.generation !== current.generation
    )
      return null;
    if (
      action.report.status === 'ready' &&
      (current.status !== 'published' || current.manifest?.generation !== current.generation)
    )
      return null;
    next.report = structuredClone(action.report);
    return next;
  }
  if (action.type === 'publish') {
    if (current.status !== 'requested') return null;
    next.manifest = { generation: current.generation, choices: structuredClone(action.choices) };
    next.status = 'published';
    delete next.report;
  } else if (action.type === 'complete') {
    if (
      !['accepted', 'cancelled'].includes(current.status) ||
      current.decision?.id !== action.decisionId
    )
      return null;
    next.status = 'completed';
    next.completion = { decisionId: action.decisionId, summary: action.summary };
  } else {
    if (action.type === 'accept') {
      if (
        current.status !== 'published' ||
        current.manifest?.generation !== current.generation ||
        ![ORIGINAL_VARIANT, ...current.manifest.choices.map((choice) => choice.id)].includes(
          action.variantId,
        )
      )
        return null;
      next.status = 'accepted';
    } else if (action.type === 'cancel') {
      if (!['requested', 'published', 'accepted'].includes(current.status)) return null;
      next.status = 'cancelled';
    } else {
      if (!['published', 'accepted'].includes(current.status) || current.generation >= 10000)
        return null;
      next.generation++;
      next.status = 'requested';
      delete next.report;
    }
    next.decision = {
      id: operation.id,
      generation: current.generation,
      kind: action.type,
      ...(action.type === 'accept' ? { variantId: action.variantId } : {}),
      feedback: action.feedback,
      createdAt: new Date().toISOString(),
    };
  }
  next.revision++;
  return VariantExplorationSchema.parse(next);
}

export function variantInstructions(exploration: VariantExploration): string {
  if (exploration.status === 'completed')
    return `UI Variants exploration ${exploration.id}, generation ${exploration.generation}, revision ${exploration.revision}. Status: completed. Cleanup has already been reported complete. No further source changes or completion calls are requested for this exploration.`;
  return `UI Variants exploration ${exploration.id}, generation ${exploration.generation}, revision ${exploration.revision}. Status: ${exploration.status}. Read ainotation_get_variants_guide before implementation. Generate ${exploration.defaultCount} candidates unless the user requests another count (1–6); original is separate. Target IDs are immutable slot IDs: ${exploration.targetIds.join(', ')}. Use the host framework to render one branch per slot. Register candidates through ainotation_publish_variants; registration is not proof of browser readiness. Read the latest state with ainotation_get_variants. The user decides when to ask you to continue. Do not wait, poll indefinitely, or auto-resume. After an accept/cancel decision, apply or restore the implementation, remove temporary variant integration, verify the page, then call ainotation_complete_variants with the exact decision ID.`;
}
