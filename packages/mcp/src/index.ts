import { createRequire } from 'node:module';
import {
  AnnotationContentSchema,
  feedbackExport,
  feedbackExportJsonSchema,
  type FeedbackExport,
  type VariantOperation,
  VariantChoicesSchema,
  variantInstructions,
} from '@ainotation/schema';
import { VARIANTS_GUIDE, VARIANTS_GUIDE_URI } from './variants-guide';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  AnnotationPatchSchema,
  CreateAnnotationSchema,
  FeedbackStore,
  StoreError,
  type AnnotationPatch,
  type CreateAnnotationInput,
} from './store';
import { ProjectSelectorSchema } from './project-choice';
import { toolResponse as respond } from './mcp-result';

export {
  createFeedbackStore,
  FeedbackStore,
  StoreError,
  type AgentAction,
  type CreateAnnotationInput,
  type AnnotationPatch,
} from './store';
export { startHttpServer } from './http';
export {
  startSharedService,
  readServiceConnection,
  defaultServiceDirectory,
  type ServiceConnection,
} from './shared-service';
export { type IssuedGrant, type ProjectGrant, type RegisteredProject } from './project-service';
export {
  initializeProject,
  discoverProject,
  declareProject,
  projectIdFor,
  ProjectDeclarationSchema,
  findProjectRoot,
  ProjectConfigSchema,
  PROJECT_CONFIG_FILE,
  ProjectError,
  type ProjectConfig,
  type ProjectInfo,
  type ProjectToolchain,
  type ProjectDeclaration,
} from './project';

export interface McpFeedbackBackend {
  variants?(sessionId: string, operation: VariantOperation): Promise<FeedbackExport>;
  getImage?(sessionId: string, imageId: string): Promise<{ data: string; mimeType: 'image/png' }>;
  list(): Promise<FeedbackExport[]>;
  get(sessionId: string): Promise<FeedbackExport>;
  createAnnotation(sessionId: string, input: CreateAnnotationInput): Promise<FeedbackExport>;
  updateAnnotation(
    sessionId: string,
    annotationId: string,
    patch: AnnotationPatch,
  ): Promise<FeedbackExport>;
  deleteAnnotation(sessionId: string, annotationId: string): Promise<FeedbackExport>;
}
export type McpBackendResolver = (project?: string) => Promise<McpFeedbackBackend>;

function variantHandoff(document: FeedbackExport) {
  const instructions = [...document.annotations, ...(document.variantCleanups ?? [])]
    .filter((annotation) => annotation.variants)
    .map((annotation) => ({
      annotationId: annotation.id,
      instructions:
        ('deletedAt' in annotation && annotation.variants?.status !== 'completed'
          ? 'Annotation deleted: restore Original and remove generated variants and temporary integration. '
          : '') + variantInstructions(annotation.variants!),
    }));
  return instructions.length ? { ...document, variantInstructions: instructions } : document;
}

export function createMcpServer(
  store: FeedbackStore | McpFeedbackBackend | McpBackendResolver = new FeedbackStore(),
): McpServer {
  const backend: McpFeedbackBackend | McpBackendResolver =
    store instanceof FeedbackStore
      ? {
          async list() {
            return store.list().map(feedbackExport);
          },
          async get(sessionId) {
            return feedbackExport(store.get(sessionId));
          },
          async getImage(sessionId, imageId) {
            return {
              data: (await store.getImage(sessionId, imageId)).toString('base64'),
              mimeType: 'image/png',
            };
          },
          async createAnnotation(sessionId, input) {
            return feedbackExport(await store.createAnnotation(sessionId, input));
          },
          async updateAnnotation(sessionId, annotationId, patch) {
            return feedbackExport(await store.updateAnnotation(sessionId, annotationId, patch));
          },
          async deleteAnnotation(sessionId, annotationId) {
            return feedbackExport(await store.deleteAnnotation(sessionId, annotationId));
          },
          async variants(sessionId, operation) {
            return feedbackExport(await store.variants(sessionId, operation));
          },
        }
      : store;
  const backendFor: McpBackendResolver =
    typeof backend === 'function' ? backend : async () => backend;
  const scope = typeof store === 'function' ? { project: ProjectSelectorSchema.optional() } : {};
  const forInput = (input: object) =>
    backendFor(
      'project' in input ? ProjectSelectorSchema.optional().parse(input.project) : undefined,
    );
  const { version } = createRequire(import.meta.url)('../package.json') as { version: string };
  const server = new McpServer({ name: 'ainotation', version });
  server.registerResource(
    'ui-variants-guide',
    VARIANTS_GUIDE_URI,
    {
      mimeType: 'text/markdown',
      description: 'UI Variants integration and decision handoff protocol v1.',
    },
    (uri) => ({ contents: [{ uri: uri.href, text: VARIANTS_GUIDE }] }),
  );
  server.registerTool(
    'ainotation_get_schema',
    {
      description: 'Return the current Ainotation feedback document schema.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(feedbackExportJsonSchema()) }],
    }),
  );
  const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    'ainotation_get_variants_guide',
    {
      description:
        'Read UI Variants protocol v1, host integration examples and cleanup requirements before generating candidates.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    () => ({ content: [{ type: 'text' as const, text: VARIANTS_GUIDE }] }),
  );
  server.registerTool(
    'ainotation_list_sessions',
    {
      description: 'List feedback sessions with annotation content and page/target context.',
      inputSchema: z.object(scope).strict(),
      annotations: readAnnotations,
    },
    (input) => respond(async () => (await (await forInput(input)).list()).map(variantHandoff)),
  );
  server.registerTool(
    'ainotation_get_feedback',
    {
      description: 'Get the feedback document with annotation content and page/target context.',
      inputSchema: z.object({ ...scope, sessionId: z.uuid() }).strict(),
      annotations: readAnnotations,
    },
    (input) =>
      respond(async () => {
        const document = await (await forInput(input)).get(input.sessionId);
        return variantHandoff(document);
      }),
  );
  const pair = { sessionId: z.uuid(), annotationId: z.uuid() };
  server.registerTool(
    'ainotation_get_image',
    {
      description:
        'Read one image attachment from a feedback session. Use an image ID from an annotation; returns PNG image content.',
      inputSchema: z.object({ ...scope, sessionId: z.uuid(), imageId: z.uuid() }).strict(),
      annotations: readAnnotations,
    },
    async (input) => {
      try {
        const backend = await forInput(input);
        if (!backend.getImage)
          throw new StoreError(501, 'This backend does not support image attachments');
        const image = await backend.getImage(input.sessionId, input.imageId);
        return { content: [{ type: 'image' as const, ...image }] };
      } catch (error) {
        return respond(async () => {
          throw error;
        });
      }
    },
  );
  const mutationAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  server.registerTool(
    'ainotation_create_annotation',
    {
      description:
        'Create an annotation using a client-provided UUID; identical retries return the existing content. Return the feedback document.',
      inputSchema: z
        .object({ ...scope, ...pair, ...CreateAnnotationSchema.omit({ id: true }).shape })
        .strict(),
      annotations: mutationAnnotations,
    },
    (input) =>
      respond(async () =>
        (await forInput(input)).createAnnotation(input.sessionId, {
          id: input.annotationId,
          comment: input.comment,
          page: input.page,
          targets: input.targets,
        }),
      ),
  );
  server.registerTool(
    'ainotation_get_annotation',
    {
      description: 'Get one annotation with its complete page and target context.',
      inputSchema: z.object({ ...scope, ...pair }).strict(),
      annotations: readAnnotations,
    },
    (input) =>
      respond(async () => {
        const backend = await forInput(input);
        const annotation = (await backend.get(input.sessionId)).annotations.find(
          (item) => item.id === input.annotationId,
        );
        if (!annotation) throw new StoreError(404, 'Annotation not found in session');
        const content = AnnotationContentSchema.parse(annotation);
        return content.variants
          ? { ...content, variantInstructions: variantInstructions(content.variants) }
          : content;
      }),
  );
  server.registerTool(
    'ainotation_update_annotation',
    {
      description:
        'Update annotation comment, page or targets; provide at least one field. Return the feedback document.',
      inputSchema: z.object({ ...scope, ...pair, patch: AnnotationPatchSchema }).strict(),
      annotations: mutationAnnotations,
    },
    (input) =>
      respond(async () =>
        (await forInput(input)).updateAnnotation(input.sessionId, input.annotationId, input.patch),
      ),
  );
  server.registerTool(
    'ainotation_delete_annotation',
    {
      description:
        'Delete an annotation; retries of a previously deleted ID succeed. Return the feedback document.',
      inputSchema: z.object({ ...scope, ...pair }).strict(),
      annotations: { ...mutationAnnotations, destructiveHint: true },
    },
    (input) =>
      respond(async () =>
        (await forInput(input)).deleteAnnotation(input.sessionId, input.annotationId),
      ),
  );
  server.registerTool(
    'ainotation_get_variants',
    {
      description:
        'Read the latest UI Variants state, browser readiness report, user decision and original target context. Previewing is not acceptance.',
      inputSchema: z.object({ ...scope, ...pair }).strict(),
      annotations: readAnnotations,
    },
    (input) =>
      respond(async () => {
        const document = await (await forInput(input)).get(input.sessionId);
        const annotation =
          document.annotations.find((item) => item.id === input.annotationId) ??
          document.variantCleanups?.find((item) => item.id === input.annotationId);
        if (!annotation?.variants) throw new StoreError(404, 'UI Variants exploration not found');
        return {
          annotation,
          instructions:
            ('deletedAt' in annotation && annotation.variants.status !== 'completed'
              ? 'Annotation deleted: restore Original and remove generated variants and temporary integration. '
              : '') + variantInstructions(annotation.variants),
          guide: VARIANTS_GUIDE_URI,
        };
      }),
  );
  const variantMutation = {
    ...scope,
    ...pair,
    operationId: z.uuid(),
    explorationId: z.uuid(),
    generation: z.number().int().positive(),
    revision: z.number().int().positive(),
  };
  server.registerTool(
    'ainotation_publish_variants',
    {
      description:
        'Register generated candidates for the exact exploration generation/revision. Original is separate. Does not claim browser readiness. Reuse operationId on retries.',
      inputSchema: z.object({ ...variantMutation, choices: VariantChoicesSchema }).strict(),
      annotations: mutationAnnotations,
    },
    (input) =>
      respond(async () => {
        const backend = await forInput(input);
        if (!backend.variants)
          throw new StoreError(501, 'Upgrade the service to support UI Variants');
        return backend.variants(input.sessionId, {
          id: input.operationId,
          kind: 'variants',
          annotationId: input.annotationId,
          explorationId: input.explorationId,
          generation: input.generation,
          revision: input.revision,
          action: { type: 'publish', choices: input.choices },
        });
      }),
  );
  server.registerTool(
    'ainotation_complete_variants',
    {
      description:
        'Report that the selected design was applied (or original restored), temporary integration removed, and checks passed. Requires the latest decision ID. Reuse operationId on retries.',
      inputSchema: z
        .object({
          ...variantMutation,
          decisionId: z.uuid(),
          summary: z.string().trim().min(1).max(2000),
        })
        .strict(),
      annotations: mutationAnnotations,
    },
    (input) =>
      respond(async () => {
        const backend = await forInput(input);
        if (!backend.variants)
          throw new StoreError(501, 'Upgrade the service to support UI Variants');
        return backend.variants(input.sessionId, {
          id: input.operationId,
          kind: 'variants',
          annotationId: input.annotationId,
          explorationId: input.explorationId,
          generation: input.generation,
          revision: input.revision,
          action: { type: 'complete', decisionId: input.decisionId, summary: input.summary },
        });
      }),
  );
  return server;
}
