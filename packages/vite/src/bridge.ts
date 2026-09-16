import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { MAX_IMAGE_BYTES, SyncRequestSchema, SyncErrorResponseSchema } from '@ainotation/schema';
import type { ProjectInfo } from '@ainotation/mcp/project';
import type { createBrowserConnection } from '@ainotation/mcp/browser';

type Connection = ReturnType<typeof createBrowserConnection>;
const digest = (value: string) => createHash('sha256').update(value).digest();
const MAX_BODY_BYTES = 1024 * 1024;

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

/** Browser-facing protocol and resource ownership, independent of Vite hooks. */
export function createDevelopmentBridge(options: {
  project: ProjectInfo;
  path: string;
  originFor: (request: IncomingMessage, boundOrigin?: string) => string | undefined;
  createConnection: (origin: string) => Connection;
}) {
  const lifetime = new AbortController();
  const tokens = new Map<string, string>();
  const connections = new Map<string, Connection>();
  let closing: Promise<void> | undefined;
  const connectionFor = (origin: string) => {
    let connection = connections.get(origin);
    if (!connection) {
      connection = options.createConnection(origin);
      connections.set(origin, connection);
    }
    return connection;
  };
  return {
    async handle(request: IncomingMessage, response: ServerResponse, suffix: string) {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('Vary', 'Origin');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      let origin = options.originFor(request);
      if (!origin) {
        json(response, 403, { error: 'Origin or Host not allowed' });
        return;
      }
      if (lifetime.signal.aborted) {
        json(response, 503, { error: 'Development bridge is closed' });
        return;
      }
      const abort = new AbortController();
      const disconnected = () => abort.abort();
      response.once('close', disconnected);
      const signal = AbortSignal.any([abort.signal, lifetime.signal]);
      try {
        if (suffix === '/connect' && request.method === 'POST') {
          if (request.headers.origin !== origin || request.headers['x-ainotation-client'] !== '1') {
            json(response, 403, { error: 'Same-origin bootstrap required' });
            return;
          }
          if (
            Number(request.headers['content-length'] ?? 0) > 0 ||
            request.headers['transfer-encoding']
          ) {
            json(response, 400, { error: 'Bootstrap expects an empty body' });
            return;
          }
          await connectionFor(origin).connect();
          if (signal.aborted) return;
          let token = tokens.get(origin);
          if (!token) {
            token = randomBytes(32).toString('hex');
            tokens.set(origin, token);
          }
          json(response, 200, {
            projectId: options.project.config.projectId,
            name: options.project.config.name,
            endpoint: `${origin}${options.path}/api`,
            token,
          });
          return;
        }
        const authorization = digest(request.headers.authorization ?? '');
        const paired = [...tokens].find(([, token]) =>
          timingSafeEqual(authorization, digest(`Bearer ${token}`)),
        );
        if (!paired) {
          json(response, 401, { error: 'Unauthorized' });
          return;
        }
        origin = options.originFor(request, paired[0]);
        if (!origin) {
          json(response, 403, { error: 'Origin or Host not allowed for this connection' });
          return;
        }
        const route =
          /^\/api(\/sessions\/[a-f0-9-]{36}\/(sync|events|images\/[a-f0-9-]{36}))$/i.exec(suffix);
        const image = route?.[2]?.startsWith('images/');
        if (
          !route ||
          (image
            ? !['GET', 'POST'].includes(request.method ?? '')
            : request.method !== (route[2] === 'sync' ? 'POST' : 'GET'))
        ) {
          json(response, 404, { error: 'Bridge route not found' });
          return;
        }
        let body: string | Uint8Array<ArrayBuffer> | undefined;
        if (request.method === 'POST') {
          if (
            !(image ? /^image\/png$/i : /^application\/json(?:\s*;\s*charset=utf-8)?$/i).test(
              request.headers['content-type'] ?? '',
            ) ||
            request.headers['content-encoding']
          ) {
            json(response, 415, {
              error: `Expected unencoded ${image ? 'image/png' : 'application/json'}`,
            });
            return;
          }
          const limit = image ? MAX_IMAGE_BYTES : MAX_BODY_BYTES;
          if (Number(request.headers['content-length']) > limit) {
            json(response, 413, { error: 'Request too large' });
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of request.iterator({ destroyOnReturn: false })) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > limit) {
              request.resume();
              json(response, 413, { error: 'Request too large' });
              return;
            }
            chunks.push(buffer);
          }
          try {
            body = image
              ? new Uint8Array(Buffer.concat(chunks))
              : JSON.stringify(
                  SyncRequestSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
                );
          } catch {
            json(response, 400, { error: 'Invalid feedback request' });
            return;
          }
        }
        signal.throwIfAborted();
        const upstream = await connectionFor(origin).fetch(route[1]!, {
          method: request.method as 'GET' | 'POST',
          ...(body === undefined ? {} : { body }),
          signal,
        });
        if (!upstream.ok || !upstream.body) {
          const diagnostic = SyncErrorResponseSchema.safeParse(
            await upstream.json().catch(() => undefined),
          );
          json(response, upstream.ok ? 502 : upstream.status, {
            ...(diagnostic.success && diagnostic.data.code ? { code: diagnostic.data.code } : {}),
            error: 'Project sync failed. Check the development server connection.',
          });
          return;
        }
        response.writeHead(200, {
          'Content-Type':
            route[2] === 'events'
              ? 'text/event-stream'
              : image && request.method === 'GET'
                ? 'image/png'
                : 'application/json',
          ...(route[2] === 'events' ? { 'X-Accel-Buffering': 'no' } : {}),
        });
        const reader = upstream.body.getReader();
        async function* chunks() {
          try {
            while (true) {
              const chunk = await reader.read();
              if (chunk.done) return;
              yield chunk.value;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        await pipeline(Readable.from(chunks()), response, { signal });
      } catch {
        if (signal.aborted || response.headersSent) response.destroy();
        else
          json(response, 503, {
            error: 'Ainotation service unavailable. Check the project and development server.',
          });
      } finally {
        response.removeListener('close', disconnected);
      }
    },
    close(): Promise<void> {
      closing ??= (async () => {
        lifetime.abort();
        await Promise.all([...connections.values()].map((connection) => connection.close()));
        connections.clear();
        tokens.clear();
      })();
      return closing;
    },
  };
}
