import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer, type ServerResponse } from 'node:http';
import { SyncRequestSchema } from '@ainotation/schema';
import { z } from 'zod';
import { FeedbackStore, StoreError } from './store';
import { readJson, isExactOrigin, sendError } from './http-common';

export async function startHttpServer(options: {
  store: FeedbackStore;
  token: string;
  origins: readonly string[];
  port?: number;
}): Promise<{ url: string; close(): Promise<void> }> {
  const { store, token, origins, port = 4748 } = options;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port');
  if (!token || /\s/.test(token))
    throw new Error('Token must be nonempty and contain no whitespace');
  if (origins.length === 0 || origins.some((origin) => !isExactOrigin(origin)))
    throw new Error('Origins must be exact HTTP(S) origins');
  const allowedOrigins = new Set(origins);
  const tokenHash = createHash('sha256').update(`Bearer ${token}`).digest();
  const streams = new Set<ServerResponse>();
  let actualPort = port;

  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Vary', 'Origin');
    const json = (status: number, body: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    void (async () => {
      if (
        ![`127.0.0.1:${actualPort}`, `localhost:${actualPort}`].includes(request.headers.host ?? '')
      )
        throw new StoreError(403, 'Invalid Host');
      const origin = request.headers.origin;
      if (!origin || !allowedOrigins.has(origin)) throw new StoreError(403, 'Origin not allowed');
      response.setHeader('Access-Control-Allow-Origin', origin);
      // Browsers do not send Authorization on preflight; all actual requests require it.
      if (request.method === 'OPTIONS') {
        const method = request.headers['access-control-request-method'];
        const headers = String(request.headers['access-control-request-headers'] ?? '')
          .toLowerCase()
          .split(',')
          .map((header) => header.trim())
          .filter(Boolean);
        if (
          !['GET', 'POST'].includes(String(method)) ||
          headers.some((header) => !['authorization', 'content-type'].includes(header))
        )
          throw new StoreError(403, 'Preflight not allowed');
        response.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        });
        response.end();
        return;
      }
      const suppliedHash = createHash('sha256')
        .update(request.headers.authorization ?? '')
        .digest();
      if (!timingSafeEqual(tokenHash, suppliedHash)) throw new StoreError(401, 'Unauthorized');
      // Exact paths also prevent tokens or other credentials from being accepted in URLs.
      if (request.method === 'GET' && request.url === '/health') {
        json(200, { ok: true });
        return;
      }
      const match = /^\/sessions\/([^/]+)\/(sync|events)$/.exec(request.url ?? '');
      if (!match) throw new StoreError(404, 'Route not found');
      const sessionId = z.uuid().parse(match[1]);
      if (match[2] === 'sync' && request.method === 'POST') {
        const input = SyncRequestSchema.parse(await readJson(request));
        json(200, await store.sync(sessionId, input, origin));
      } else if (match[2] === 'events' && request.method === 'GET') {
        store.get(sessionId, origin);
        response.writeHead(200, {
          'Content-Type': 'text/event-stream',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        const changed = () => {
          if (!response.write(`event: changed\ndata: ${JSON.stringify({ sessionId })}\n\n`))
            response.destroy();
        };
        const unsubscribe = store.subscribe(sessionId, changed);
        streams.add(response);
        const heartbeat = setInterval(() => {
          if (!response.write(': heartbeat\n\n')) response.destroy();
        }, 15000);
        heartbeat.unref();
        response.once('close', () => {
          clearInterval(heartbeat);
          unsubscribe();
          streams.delete(response);
        });
        changed();
      } else throw new StoreError(405, 'Method not allowed');
    })().catch((error: unknown) => sendError(response, error));
  });
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
  if (!address || typeof address === 'string') throw new Error('HTTP server has no TCP address');
  actualPort = address.port;
  let closing: Promise<void> | undefined;
  return {
    url: `http://127.0.0.1:${actualPort}`,
    close() {
      closing ??= new Promise<void>((resolve, reject) => {
        for (const response of streams) response.end();
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
      return closing;
    },
  };
}
