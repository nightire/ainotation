import { z } from 'zod';
import { FeedbackImagesSchema, imageFilename } from './images';
import { StyleChangesSchema } from './styles';
import {
  VariantExplorationSchema,
  VariantOperationSchema,
  createVariantExploration,
  canStartVariantExploration,
  transitionVariants,
  variantInstructions,
  variantActive,
} from './variants';
export * from './images';
export * from './styles';
export * from './variants';

export const FEEDBACK_SCHEMA_VERSION = 1;

export const OutputDetailSchema = z.enum(['compact', 'standard', 'detailed', 'forensic']);
export type OutputDetail = z.infer<typeof OutputDetailSchema>;

export const DomContextNodeSchema = z.object({
  tagName: z.string().min(1).max(100),
  attributes: z.record(z.string().max(100), z.string().max(1000)),
  text: z.string().max(160).optional(),
  shadowHost: z.boolean().optional(),
});

export const RectSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
});

export const TargetSnapshotSchema = z.object({
  id: z.uuid(),
  selector: z.string().min(1).max(4000),
  shadowHosts: z.array(z.string().min(1).max(4000)).max(20),
  tagName: z.string().min(1).max(100),
  text: z.string().max(500),
  attributes: z.record(z.string().max(100), z.string().max(1000)),
  rect: RectSchema,
  styles: z.record(z.string().max(100), z.string().max(1000)),
  styleChanges: StyleChangesSchema.optional(),
  styleTargetId: z.uuid().optional(),
  states: z.object({ focused: z.boolean(), focusWithin: z.boolean() }).optional(),
  label: z.string().max(160).optional(),
  ancestors: z.array(DomContextNodeSchema).max(32).optional(),
  ancestryTruncated: z.boolean().optional(),
  nearbyText: z.object({ before: z.string().max(160), after: z.string().max(160) }).optional(),
  nearbyElements: z.array(DomContextNodeSchema).max(4).optional(),
  siblingCount: z.number().int().nonnegative().optional(),
  accessibility: z.object({ focusable: z.boolean() }).optional(),
  textSelection: z
    .object({
      exact: z.string().min(1).max(1000),
      prefix: z.string().max(64),
      suffix: z.string().max(64),
      truncated: z.boolean(),
      rects: z.array(RectSchema).max(32),
    })
    .optional(),
});

export const PageSnapshotSchema = z.object({
  url: z.url().max(8000),
  title: z.string().max(1000),
  userAgent: z.string().max(1000).optional(),
  capturedAt: z.iso.datetime().optional(),
  viewport: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    devicePixelRatio: z.number().positive(),
    scrollX: z.number().finite(),
    scrollY: z.number().finite(),
  }),
});

export const ReplySchema = z.object({
  id: z.uuid(),
  role: z.enum(['human', 'agent']),
  message: z.string().trim().min(1).max(10000),
  createdAt: z.iso.datetime(),
});

export const AnnotationStatusSchema = z.enum(['pending', 'acknowledged', 'resolved', 'dismissed']);
export const MarkerAnchorSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
  space: z.enum(['document', 'viewport']),
  targetId: z.uuid().optional(),
  ratioX: z.number().finite().optional(),
  ratioY: z.number().finite().optional(),
});
export type MarkerAnchor = z.infer<typeof MarkerAnchorSchema>;
export const AnnotationSchema = z.object({
  id: z.uuid(),
  comment: z.string().trim().min(1).max(10000),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  page: PageSnapshotSchema,
  targets: z.array(TargetSnapshotSchema).min(1).max(20),
  marker: MarkerAnchorSchema.optional(),
  images: FeedbackImagesSchema.optional(),
  variants: VariantExplorationSchema.optional(),
  status: AnnotationStatusSchema,
  replies: z.array(ReplySchema).max(500),
});

export const FeedbackDocumentSchema = z.object({
  schemaVersion: z.literal(FEEDBACK_SCHEMA_VERSION),
  id: z.uuid(),
  url: z.url().max(8000),
  createdAt: z.iso.datetime(),
  annotations: z.array(AnnotationSchema).max(1000),
  targetStyles: z.record(z.uuid(), StyleChangesSchema).optional(),
  variantCleanups: z
    .array(
      AnnotationSchema.omit({ status: true, replies: true, images: true, marker: true }).extend({
        variants: VariantExplorationSchema.refine(
          (value) =>
            ['cancelled', 'completed'].includes(value.status) && value.decision?.kind === 'cancel',
          'Deleted explorations must remain cancelled until cleanup completes.',
        ),
        deletedAt: z.iso.datetime(),
        reason: z.literal('annotation-deleted'),
      }),
    )
    .max(1000)
    .optional(),
});

// Public annotation handoff omits the conversation retained in persistent storage.
export const AnnotationContentSchema = AnnotationSchema.omit({ status: true, replies: true });
export const FeedbackExportSchema = FeedbackDocumentSchema.extend({
  annotations: z.array(AnnotationContentSchema).max(1000),
});
export type AnnotationContent = z.infer<typeof AnnotationContentSchema>;
export type FeedbackExport = z.infer<typeof FeedbackExportSchema>;

/** Includes deleted exploration context without turning it back into a page annotation. */
export function variantAnnotations(
  document: Pick<FeedbackExport, 'annotations' | 'variantCleanups'>,
) {
  return [...document.annotations, ...(document.variantCleanups ?? [])];
}

export function feedbackExport(document: FeedbackDocument): FeedbackExport {
  return FeedbackExportSchema.parse(normalizeSharedStyles(document));
}

export const styleTargetKey = (target: TargetSnapshot) => target.styleTargetId ?? target.id;

/** targetStyles is authoritative; inline styleChanges are compatibility projections.
 * Only explicit mutation inputs may change the shared record. Read-time projection
 * cannot resurrect stale styles from another marker's captured target snapshot.
 */
export function normalizeSharedStyles(
  document: FeedbackDocument,
  updates: TargetSnapshot[] = [],
  links: Record<string, string> = {},
): FeedbackDocument {
  const next = structuredClone(document);
  const shared = structuredClone(next.targetStyles ?? {});
  if (!next.targetStyles)
    for (const annotation of [...next.annotations].sort((a, b) =>
      a.updatedAt.localeCompare(b.updatedAt),
    ))
      for (const target of annotation.targets)
        if (target.styleChanges?.length) {
          const key = styleTargetKey(target);
          shared[key] = [
            ...new Map(
              [...(shared[key] ?? []), ...structuredClone(target.styleChanges)].map((change) => [
                change.property,
                change,
              ]),
            ).values(),
          ];
        }
  const aliases = new Map([
    ...Object.entries(links),
    ...updates.map((target) => [target.id, styleTargetKey(target)] as const),
  ]);
  for (const [id, key] of aliases) if (shared[id] && !shared[key]) shared[key] = shared[id]!;
  for (const target of updates) {
    const key = styleTargetKey(target);
    if (key !== target.id && shared[target.id] && !shared[key]) shared[key] = shared[target.id]!;
    if (target.styleChanges !== undefined) shared[key] = structuredClone(target.styleChanges);
  }
  const referenced = new Set<string>();
  for (const annotation of next.annotations)
    for (const target of annotation.targets) {
      const alias = aliases.get(target.id);
      if (alias && alias !== target.id) target.styleTargetId = alias;
      else if (alias) delete target.styleTargetId;
      const key = styleTargetKey(target);
      referenced.add(key);
      delete target.styleChanges;
      if (shared[key]?.length) target.styleChanges = structuredClone(shared[key]);
    }
  const retained = Object.fromEntries(
    Object.entries(shared).filter(([key, changes]) => referenced.has(key) && changes.length),
  );
  if (Object.keys(retained).length) next.targetStyles = retained;
  else delete next.targetStyles;
  return next;
}

export function feedbackExportJsonSchema() {
  return z.toJSONSchema(FeedbackExportSchema, { target: 'draft-2020-12' });
}

export const FeedbackOperationSchema = z.discriminatedUnion('kind', [
  z.object({
    id: z.uuid(),
    kind: z.literal('upsert'),
    annotation: AnnotationSchema,
    styleLinks: z.record(z.uuid(), z.uuid()).optional(),
    variantRequest: z.uuid().optional(),
  }),
  z.object({ id: z.uuid(), kind: z.literal('delete'), annotationId: z.uuid() }),
  z.object({
    id: z.uuid(),
    kind: z.literal('reply'),
    annotationId: z.uuid(),
    reply: ReplySchema.extend({ role: z.literal('human') }),
  }),
  z.object({ id: z.uuid(), kind: z.literal('reopen'), annotationId: z.uuid() }),
  VariantOperationSchema,
]);

export const SyncRequestSchema = z.object({
  document: FeedbackDocumentSchema,
  operations: z.array(FeedbackOperationSchema).max(1000),
  storageEpoch: z.uuid().optional(),
  recovery: z
    .object({
      epoch: z.uuid(),
      revision: z.string().regex(/^[a-f0-9]{64}$/),
      source: z.enum(['browser', 'server']),
    })
    .optional(),
});

/** Machine-readable diagnostics shared by the service, dev proxy and browser client. */
export const SyncErrorCodeSchema = z.enum([
  'recovery-stale',
  'storage-conflict',
  'storage-unavailable',
  'storage-damaged',
  'service-ownership',
  'variants-busy',
]);
export const SyncErrorResponseSchema = z.object({ code: SyncErrorCodeSchema.optional() });
export type SyncErrorCode = z.infer<typeof SyncErrorCodeSchema>;

export const SyncResponseSchema = z
  .object({
    document: FeedbackDocumentSchema,
    acknowledged: z.array(z.uuid()),
    styleSuggestions: z.literal(true).optional(),
    sharedStyles: z.literal(true).optional(),
    uiVariants: z.literal(1).optional(),
    uiVariantsCleanup: z.literal(1).optional(),
    variantConflicts: z.array(z.uuid()).max(1000).optional(),
    storageEpoch: z.uuid().optional(),
    missingImages: z.array(z.uuid()).optional(),
    recovery: z.object({ revision: z.string().regex(/^[a-f0-9]{64}$/) }).optional(),
  })
  .refine(
    (value) => !value.recovery || !!value.storageEpoch,
    'Recovery responses require a storage epoch.',
  );

export type Annotation = z.infer<typeof AnnotationSchema>;
export type FeedbackDocument = z.infer<typeof FeedbackDocumentSchema>;
export type TargetSnapshot = z.infer<typeof TargetSnapshotSchema>;
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;
export type Reply = z.infer<typeof ReplySchema>;
export type AnnotationStatus = z.infer<typeof AnnotationStatusSchema>;
export type FeedbackOperation = z.infer<typeof FeedbackOperationSchema>;
export type SyncRequest = z.infer<typeof SyncRequestSchema>;
export type SyncResponse = z.infer<typeof SyncResponseSchema>;

export function applyFeedbackOperation(
  document: FeedbackDocument,
  operation: FeedbackOperation,
): FeedbackDocument {
  const next = structuredClone(document);
  const id = operation.kind === 'upsert' ? operation.annotation.id : operation.annotationId;
  const index = next.annotations.findIndex((item) => item.id === id);
  const annotation = next.annotations[index];
  if (operation.kind === 'upsert') {
    if (next.variantCleanups?.some((entry) => entry.id === id)) return next;
    if (annotation) {
      next.annotations[index] = {
        ...operation.annotation,
        status: annotation.status,
        replies: annotation.replies,
        variants: annotation.variants,
      };
    } else next.annotations.push(structuredClone(operation.annotation));
    const saved = next.annotations.find((item) => item.id === id)!;
    // Ordinary edits never replace an exploration or change its original target set.
    if (annotation?.variants) saved.targets = structuredClone(annotation.targets);
    const startingVariants =
      operation.variantRequest &&
      canStartVariantExploration(
        saved.variants,
        operation.variantRequest,
        operation.annotation.variants,
      );
    if (
      startingVariants &&
      variantAnnotations(next).some((item) => item.id !== id && variantActive(item.variants))
    )
      throw new Error('Another annotation already owns UI Variants on this page.');
    if (startingVariants)
      saved.variants = createVariantExploration(
        operation.variantRequest!,
        saved.targets.map((target) => target.id),
      );
    if (saved.variants === undefined) delete saved.variants;
  } else if (operation.kind === 'delete') {
    if (annotation?.variants && variantActive(annotation.variants)) {
      const current = annotation.variants;
      const variants =
        current.status === 'cancelled'
          ? current
          : transitionVariants(current, {
              id: operation.id,
              kind: 'variants',
              annotationId: id,
              explorationId: current.id,
              generation: current.generation,
              revision: current.revision,
              action: { type: 'cancel', feedback: current.decision?.feedback ?? '' },
            })!;
      next.variantCleanups = [
        ...(next.variantCleanups ?? []).filter((entry) => entry.id !== id),
        {
          id,
          comment: annotation.comment,
          createdAt: annotation.createdAt,
          updatedAt: annotation.updatedAt,
          page: structuredClone(annotation.page),
          targets: structuredClone(annotation.targets),
          variants,
          deletedAt: new Date().toISOString(),
          reason: 'annotation-deleted',
        },
      ];
    }
    next.annotations = next.annotations.filter((item) => item.id !== id);
  } else if (
    annotation &&
    operation.kind === 'reply' &&
    !annotation.replies.some((reply) => reply.id === operation.reply.id)
  ) {
    annotation.replies.push(structuredClone(operation.reply));
    annotation.updatedAt = operation.reply.createdAt;
  } else if (annotation && operation.kind === 'reopen') {
    annotation.status = 'pending';
  } else if (operation.kind === 'variants') {
    const owner = annotation ?? next.variantCleanups?.find((entry) => entry.id === id);
    const updated = owner?.variants && transitionVariants(owner.variants, operation);
    if (updated) owner!.variants = updated;
  }
  return normalizeSharedStyles(
    next,
    operation.kind === 'upsert' ? operation.annotation.targets : [],
    operation.kind === 'upsert' ? operation.styleLinks : undefined,
  );
}

export function feedbackMarkdown(
  document: FeedbackDocument,
  options: { includeConversation?: boolean; detail?: OutputDetail } = {},
): string {
  document = normalizeSharedStyles(document);
  const detail = options.detail ?? 'standard';
  const detailed = detail === 'detailed' || detail === 'forensic';
  const forensic = detail === 'forensic';
  const quote = (text: string) =>
    text
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => `> ${line}`)
      .join('\n');
  const compactTarget = (target: TargetSnapshot) => {
    const text = target.textSelection?.exact;
    const selected = text
      ? ` — selected ${JSON.stringify(text.slice(0, 30))}${text.length > 30 ? '…' : ''}`
      : '';
    return `${JSON.stringify(target.label || target.tagName)} (${JSON.stringify(target.selector)})${selected}`;
  };
  const domPath = (target: TargetSnapshot) =>
    [...(target.ancestors ?? []), target]
      .map((node) => {
        const identifier = node.attributes.id
          ? `#${node.attributes.id}`
          : node.attributes.class
            ? `.${node.attributes.class.split(/\s+/).filter(Boolean).join('.')}`
            : '';
        const boundary = 'shadowHost' in node && node.shadowHost ? ' ::shadow' : '';
        return `${node.tagName}${identifier}${boundary}`;
      })
      .join(' > ');
  const emittedStyles = new Set<string>();
  const variantNotes = (annotation: Annotation) =>
    annotation.variants
      ? `\nUI Variants: ${variantInstructions(annotation.variants)}\n${JSON.stringify(annotation.variants)}`
      : '';
  const styleNotes = (target: TargetSnapshot) => {
    if (!target.styleChanges?.length) return '';
    const key = styleTargetKey(target);
    if (emittedStyles.has(key)) return `Style suggestions: shared target ${key} (see above).`;
    emittedStyles.add(key);
    return `Style suggestions for ${JSON.stringify(target.selector)} (shared target ${key}; previewed at the recorded viewport; implement using the project's existing styles):\n${target.styleChanges.map((change) => `- ${change.property}: ${JSON.stringify(change.before)} → ${JSON.stringify(change.value)}`).join('\n')}`;
  };
  return [
    `# Page feedback`,
    `Page: ${document.url}`,
    ...(forensic ? [`Session: ${document.id}`] : []),
    ...document.annotations.map((annotation, index) =>
      detail === 'compact'
        ? `${index + 1}. ${annotation.targets.map(compactTarget).join('; ')}\n${quote(annotation.comment)}${variantNotes(annotation)}${annotation.images?.length ? `\nImages: ${annotation.images.map(imageFilename).join(', ')}` : ''}${annotation.targets.some((target) => target.styleChanges?.length) ? `\n${annotation.targets.map(styleNotes).filter(Boolean).join('\n')}` : ''}`
        : [
            `## ${index + 1}. ${options.includeConversation ? annotation.status : 'Annotation'} (${annotation.id})`,
            `Page: ${annotation.page.url}`,
            ...(forensic && annotation.marker
              ? [`Marker anchor: ${JSON.stringify(annotation.marker)}`]
              : []),
            `Viewport: ${annotation.page.viewport.width} x ${annotation.page.viewport.height}; DPR ${annotation.page.viewport.devicePixelRatio}; scroll ${annotation.page.viewport.scrollX}, ${annotation.page.viewport.scrollY}`,
            ...(forensic
              ? [
                  `Page title: ${JSON.stringify(annotation.page.title)}`,
                  ...(annotation.page.userAgent
                    ? [`User Agent: ${JSON.stringify(annotation.page.userAgent)}`]
                    : []),
                  ...(annotation.page.capturedAt
                    ? [`Captured at: ${annotation.page.capturedAt}`]
                    : []),
                ]
              : []),
            quote(annotation.comment),
            ...(annotation.variants ? [variantNotes(annotation)] : []),
            ...(annotation.images?.map(
              (image) =>
                `Image: ${imageFilename(image)} (${image.width} × ${image.height}); attachment ID: ${image.id}`,
            ) ?? []),
            ...annotation.targets.map((target, targetIndex) =>
              [
                `### Target ${targetIndex + 1}`,
                `Selector: ${JSON.stringify(target.selector)}`,
                ...(target.styleChanges?.length ? [styleNotes(target)] : []),
                ...(target.shadowHosts.length
                  ? [`Shadow hosts: ${JSON.stringify(target.shadowHosts)}`]
                  : []),
                `Element: ${JSON.stringify(target.label || target.tagName)}`,
                ...(target.textSelection
                  ? [
                      `Selected text: ${JSON.stringify(target.textSelection.exact)}${target.textSelection.truncated ? ' (truncated)' : ''}`,
                    ]
                  : []),
                ...(detailed
                  ? [
                      `Classes: ${JSON.stringify(target.attributes.class || '')}`,
                      `Bounds (viewport px): ${JSON.stringify(target.rect)}`,
                      ...(target.textSelection
                        ? [
                            `Selection context: ${JSON.stringify({ prefix: target.textSelection.prefix, suffix: target.textSelection.suffix })}`,
                          ]
                        : [
                            `Text: ${JSON.stringify(target.text)}`,
                            ...(target.nearbyText
                              ? [`Nearby text: ${JSON.stringify(target.nearbyText)}`]
                              : []),
                          ]),
                      ...(target.states
                        ? [`States at selection: ${JSON.stringify(target.states)}`]
                        : []),
                    ]
                  : []),
                ...(forensic
                  ? [
                      ...(target.ancestors
                        ? [
                            `DOM path${target.ancestryTruncated ? ' (truncated)' : ''}: ${JSON.stringify(domPath(target))}`,
                          ]
                        : []),
                      `Attributes: ${JSON.stringify(target.attributes)}`,
                      `Styles at annotation: ${JSON.stringify(target.styles)}`,
                      ...(target.accessibility
                        ? [`Accessibility: ${JSON.stringify(target.accessibility)}`]
                        : []),
                      ...(target.nearbyElements
                        ? [
                            `Nearby elements (${target.siblingCount ?? target.nearbyElements.length} siblings): ${JSON.stringify(target.nearbyElements)}`,
                          ]
                        : []),
                      ...(target.textSelection
                        ? [
                            `Selection bounds (viewport px): ${JSON.stringify(target.textSelection.rects)}`,
                          ]
                        : []),
                    ]
                  : []),
              ].join('\n'),
            ),
            ...(options.includeConversation
              ? annotation.replies.map(
                  (reply) => `${reply.role} (${reply.createdAt}):\n${quote(reply.message)}`,
                )
              : []),
          ].join('\n\n'),
    ),
    ...(document.variantCleanups ?? [])
      .filter((entry) => variantActive(entry.variants))
      .map(
        (entry) =>
          `## Pending UI Variants cleanup (${entry.id})\n\nAnnotation deleted at ${entry.deletedAt}. Restore the original implementation and remove generated candidates, CSS and temporary integration.\n\n${quote(entry.comment)}\n\n${JSON.stringify(entry, null, 2)}\n\n${variantInstructions(entry.variants)}`,
      ),
  ].join('\n\n');
}

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
