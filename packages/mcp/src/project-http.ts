import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  AnnotationContentSchema,
  feedbackExport,
  feedbackExportJsonSchema,
  SyncRequestSchema,
  STYLE_SYNC_CAPABILITIES,
} from '@ainotation/schema';
import { z } from 'zod';
import { AnnotationPatchSchema, CreateAnnotationSchema, StoreError } from './store';
import { GrantRequestSchema, type ProjectService } from './project-service';
import { matchesToken, readJson, sendError, sendJson } from './http-common';
import { ProjectDeclarationSchema, ProjectError } from './project';
import { imageHttp } from './image-http';

type Scope = Awaited<ReturnType<ProjectService['authorize']>>;

export async function startProjectHttpServer(options: {
  service: ProjectService;
  controlToken: string;
  instanceId: string;
  port?: number;
  beforeRequest?: () => Promise<void>;
  repair?: () => Promise<void>;
  maintenanceHealthy?: () => boolean;
}) {
  const { service, controlToken, instanceId, port = 0 } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (controlToken.length < 32 || /\s/.test(controlToken))
    throw new Error('Invalid control credential');
  let actualPort = port;
  let closed = false;
  const streams = new Set<ServerResponse>();
  const scopeFor = (request: IncomingMessage) =>
    service.authorize(request.headers.authorization, request.headers.origin);
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    const json = (status: number, value: unknown) => sendJson(response, status, value);
    void (async () => {
      if (closed) throw new StoreError(503, 'Service is closing');
      if (
        ![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(request.headers.host ?? '')
      )
        throw new StoreError(403, 'Invalid Host');
      const path = request.url ?? '';
      if (path.includes('?') || path.includes('#')) throw new StoreError(404, 'Route not found');
      const control = path.startsWith('/control/');
      const origin = request.headers.origin;
      if (control) {
        if (origin !== undefined)
          throw new StoreError(403, 'Control API is not available to browser origins');
        if (!matchesToken(request.headers.authorization, controlToken))
          throw new StoreError(401, 'Unauthorized');
        if (path === '/control/health' && request.method === 'GET') {
          json(200, {
            ok: true,
            version: 1,
            instanceId,
            capabilities: { projectDeclarations: true, recovery: !!options.repair },
            maintenanceHealthy: options.maintenanceHealthy?.() ?? true,
          });
          return;
        }
        if (path === '/control/repair' && request.method === 'POST' && options.repair) {
          await options.repair();
          json(200, { ok: true, instanceId });
          return;
        }
        await options.beforeRequest?.();
        if (path === '/control/projects' && request.method === 'GET') {
          json(200, { projects: service.listProjects() });
          return;
        }
        if (path === '/control/projects' && request.method === 'POST') {
          const input = z
            .object({
              directory: z.string().min(1).max(8000),
              declaration: ProjectDeclarationSchema.optional(),
            })
            .strict()
            .parse(await readJson(request));
          json(200, await service.register(input.directory, input.declaration));
          return;
        }
        if (path === '/control/projects/resolve' && request.method === 'POST') {
          const input = z
            .object({ directory: z.string().min(1).max(8000) })
            .strict()
            .parse(await readJson(request));
          try {
            const project = await service.resolveProject(input.directory);
            if (!project)
              throw new StoreError(
                404,
                'Start the Web project with ainotation({ name }) to register it.',
              );
            json(200, project);
          } catch (error) {
            if (error instanceof ProjectError) throw new StoreError(400, error.message);
            throw error;
          }
          return;
        }
        if (path === '/control/grants' && request.method === 'POST') {
          json(201, service.issue(GrantRequestSchema.parse(await readJson(request))));
          return;
        }
        if (path === '/control/grants' && request.method === 'GET') {
          json(200, { grants: service.listGrants() });
          return;
        }
        const grant = /^\/control\/grants\/([^/]+)(\/renew)?$/.exec(path);
        if (grant) {
          const id = z.uuid().parse(grant[1]);
          if (request.method === 'POST' && grant[2]) {
            json(200, service.renew(id));
            return;
          }
          if (request.method === 'DELETE' && !grant[2]) {
            service.revoke(id);
            response.writeHead(204);
            response.end();
            return;
          }
        }
        throw new StoreError(404, 'Control route not found');
      }
      if (origin !== undefined) {
        if (!service.allowsOrigin(origin)) throw new StoreError(403, 'Origin not allowed');
        response.setHeader('Access-Control-Allow-Origin', origin);
      }
      if (request.method === 'OPTIONS') {
        if (origin === undefined) throw new StoreError(403, 'Origin required');
        const headers = String(request.headers['access-control-request-headers'] ?? '')
          .toLowerCase()
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean);
        if (
          !['GET', 'POST', 'PATCH', 'DELETE'].includes(
            String(request.headers['access-control-request-method']),
          ) ||
          headers.some((value) => !['authorization', 'content-type'].includes(value))
        )
          throw new StoreError(403, 'Preflight not allowed');
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        });
        response.end();
        return;
      }
      await options.beforeRequest?.();
      let scope = await scopeFor(request);
      if (
        await imageHttp(request, response, async () => {
          const authorized = await scopeFor(request);
          return {
            store: authorized.store,
            ...(authorized.grant.kind === 'browser' ? { origin: authorized.grant.origin } : {}),
          };
        })
      )
        return;
      if (request.method === 'GET' && path === '/health') {
        json(200, {
          ok: true,
          version: 1,
          instanceId,
          project: { projectId: scope.project.projectId, name: scope.project.name },
          capabilities: STYLE_SYNC_CAPABILITIES,
        });
        return;
      }
      if (request.method === 'GET' && path === '/project') {
        json(200, { projectId: scope.project.projectId, name: scope.project.name });
        return;
      }
      const browserSync = /^\/sessions\/([^/]+)\/sync$/.exec(path);
      if (browserSync && request.method === 'POST') {
        if (scope.grant.kind !== 'browser')
          throw new StoreError(403, 'Browser connection required');
        const sessionId = z.uuid().parse(browserSync[1]);
        const input = SyncRequestSchema.parse(await readJson(request));
        scope = await scopeFor(request); // Revocation/expiry may occur while receiving the body.
        if (scope.grant.kind !== 'browser')
          throw new StoreError(403, 'Browser connection required');
        json(200, await scope.store.sync(sessionId, input, scope.grant.origin));
        return;
      }
      const events = /^\/sessions\/([^/]+)\/events$/.exec(path);
      if (events && request.method === 'GET') {
        const sessionId = z.uuid().parse(events[1]);
        scope.store.get(sessionId, scope.grant.kind === 'browser' ? scope.grant.origin : undefined);
        openEvents(response, scope, sessionId);
        return;
      }
      if (scope.grant.kind !== 'agent') throw new StoreError(403, 'Agent connection required');
      if (request.method === 'GET' && path === '/schema') {
        json(200, feedbackExportJsonSchema());
        return;
      }
      if (request.method === 'GET' && path === '/sessions') {
        json(200, { sessions: scope.store.list().map(feedbackExport) });
        return;
      }
      const session = /^\/sessions\/([^/]+)$/.exec(path);
      if (session && request.method === 'GET') {
        json(200, feedbackExport(scope.store.get(z.uuid().parse(session[1]))));
        return;
      }
      const annotation = /^\/sessions\/([^/]+)\/annotations(?:\/([^/]+))?$/.exec(path);
      if (!annotation) throw new StoreError(404, 'Route not found');
      const sessionId = z.uuid().parse(annotation[1]);
      const annotationId = annotation[2] ? z.uuid().parse(annotation[2]) : undefined;
      if (request.method === 'POST' && !annotationId) {
        const input = CreateAnnotationSchema.parse(await readJson(request));
        scope = await scopeFor(request);
        json(200, feedbackExport(await scope.store.createAnnotation(sessionId, input)));
        return;
      }
      if (!annotationId) throw new StoreError(405, 'Method not allowed');
      if (request.method === 'GET') {
        const found = scope.store
          .get(sessionId)
          .annotations.find((item) => item.id === annotationId);
        if (!found) throw new StoreError(404, 'Annotation not found in session');
        json(200, AnnotationContentSchema.parse(found));
        return;
      }
      if (request.method === 'PATCH') {
        const patch = AnnotationPatchSchema.parse(await readJson(request));
        scope = await scopeFor(request);
        json(
          200,
          feedbackExport(await scope.store.updateAnnotation(sessionId, annotationId, patch)),
        );
        return;
      }
      if (request.method === 'DELETE') {
        json(200, feedbackExport(await scope.store.deleteAnnotation(sessionId, annotationId)));
        return;
      }
      throw new StoreError(405, 'Method not allowed');
    })().catch((error) => sendError(response, error));
  });

  function openEvents(response: ServerResponse, scope: Scope, sessionId: string) {
    if (scope.signal.aborted) throw new StoreError(401, 'Unauthorized');
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    streams.add(response);
    const close = () => response.end();
    const changed = () => {
      if (scope.signal.aborted || response.destroyed) return;
      if (!response.write(`event: changed\ndata: ${JSON.stringify({ sessionId })}\n\n`))
        response.destroy();
    };
    const unsubscribe = scope.store.subscribe(sessionId, changed);
    const heartbeat = setInterval(() => {
      if (!response.write(': heartbeat\n\n')) response.destroy();
    }, 15000);
    heartbeat.unref();
    scope.signal.addEventListener('abort', close, { once: true });
    response.once('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      streams.delete(response);
      scope.signal.removeEventListener('abort', close);
    });
    changed();
  }

  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  actualPort = address.port;
  const expiry = setInterval(() => service.expire(), 1000);
  expiry.unref();
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close(): Promise<void> {
      closing ??= new Promise<void>((resolve, reject) => {
        closed = true;
        clearInterval(expiry);
        for (const stream of streams) stream.end();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
