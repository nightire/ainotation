import {
  AnnotationContentSchema,
  feedbackExport,
  feedbackExportJsonSchema,
} from '@ainotation/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AnnotationPatchSchema, CreateAnnotationSchema, FeedbackStore, StoreError } from './store';

export {
  createFeedbackStore,
  FeedbackStore,
  StoreError,
  type AgentAction,
  type CreateAnnotationInput,
  type AnnotationPatch,
} from './store';
export { startHttpServer } from './http';

export function createMcpServer(store: FeedbackStore = new FeedbackStore()): McpServer {
  const server = new McpServer({ name: 'ainotation', version: '0.0.0' });
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
  const result = (value: unknown) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  });
  const readAnnotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  const respond = async (run: () => unknown) => {
    try {
      return result(await run());
    } catch (error) {
      return {
        ...result({
          error: error instanceof StoreError ? error.message : 'Feedback operation failed',
        }),
        isError: true,
      };
    }
  };
  server.registerTool(
    'ainotation_list_sessions',
    {
      description: 'List feedback sessions with annotation content and page/target context.',
      inputSchema: {},
      annotations: readAnnotations,
    },
    () => respond(() => store.list().map(feedbackExport)),
  );
  server.registerTool(
    'ainotation_get_feedback',
    {
      description: 'Get the feedback document with annotation content and page/target context.',
      inputSchema: { sessionId: z.uuid() },
      annotations: readAnnotations,
    },
    ({ sessionId }) => respond(() => feedbackExport(store.get(sessionId))),
  );
  const pair = { sessionId: z.uuid(), annotationId: z.uuid() };
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
        .object({ ...pair, ...CreateAnnotationSchema.omit({ id: true }).shape })
        .strict(),
      annotations: mutationAnnotations,
    },
    ({ sessionId, annotationId, ...content }) =>
      respond(async () =>
        feedbackExport(await store.createAnnotation(sessionId, { id: annotationId, ...content })),
      ),
  );
  server.registerTool(
    'ainotation_get_annotation',
    {
      description: 'Get one annotation with its complete page and target context.',
      inputSchema: z.object(pair).strict(),
      annotations: readAnnotations,
    },
    ({ sessionId, annotationId }) =>
      respond(() => {
        const annotation = store
          .get(sessionId)
          .annotations.find((item) => item.id === annotationId);
        if (!annotation) throw new StoreError(404, 'Annotation not found in session');
        return AnnotationContentSchema.parse(annotation);
      }),
  );
  server.registerTool(
    'ainotation_update_annotation',
    {
      description:
        'Update annotation comment, page or targets; provide at least one field. Return the feedback document.',
      inputSchema: z.object({ ...pair, patch: AnnotationPatchSchema }).strict(),
      annotations: mutationAnnotations,
    },
    ({ sessionId, annotationId, patch }) =>
      respond(async () =>
        feedbackExport(await store.updateAnnotation(sessionId, annotationId, patch)),
      ),
  );
  server.registerTool(
    'ainotation_delete_annotation',
    {
      description:
        'Delete an annotation; retries of a previously deleted ID succeed. Return the feedback document.',
      inputSchema: z.object(pair).strict(),
      annotations: { ...mutationAnnotations, destructiveHint: true },
    },
    ({ sessionId, annotationId }) =>
      respond(async () => feedbackExport(await store.deleteAnnotation(sessionId, annotationId))),
  );
  return server;
}
