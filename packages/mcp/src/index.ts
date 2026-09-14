import { createRequire } from 'node:module';
import {
  AnnotationContentSchema,
  feedbackExport,
  feedbackExportJsonSchema,
  type FeedbackExport,
} from '@ainotation/schema';
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
    'ainotation_list_sessions',
    {
      description: 'List feedback sessions with annotation content and page/target context.',
      inputSchema: z.object(scope).strict(),
      annotations: readAnnotations,
    },
    (input) => respond(async () => (await forInput(input)).list()),
  );
  server.registerTool(
    'ainotation_get_feedback',
    {
      description: 'Get the feedback document with annotation content and page/target context.',
      inputSchema: z.object({ ...scope, sessionId: z.uuid() }).strict(),
      annotations: readAnnotations,
    },
    (input) => respond(async () => (await forInput(input)).get(input.sessionId)),
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
        return AnnotationContentSchema.parse(annotation);
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
  return server;
}
