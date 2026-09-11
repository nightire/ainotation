#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createFeedbackStore, createMcpServer, startHttpServer } from './index';

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '4748' },
      origin: { type: 'string', multiple: true },
      store: { type: 'string' },
      memory: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stderr.write(
      'Usage: ainotation-mcp [--port 4748] [--origin URL ...] [--store PATH | --memory]\nToken: AINOTATION_TOKEN, or a generated token printed to stderr.\n',
    );
    return;
  }
  const port = Number(values.port);
  if (!/^\d+$/.test(values.port) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be an integer from 1 to 65535');
  if (values.memory && values.store !== undefined)
    throw new Error('--memory and --store are mutually exclusive');
  const origins = values.origin ?? ['http://127.0.0.1:5173', 'http://localhost:5173'];
  const token = process.env.AINOTATION_TOKEN ?? randomBytes(32).toString('hex');
  const store = await createFeedbackStore(
    values.memory
      ? {}
      : { filePath: values.store ?? join(homedir(), '.ainotation', String(port), 'feedback.json') },
  );
  const http = await startHttpServer({ store, token, origins, port });
  const server = createMcpServer(store);
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= Promise.resolve().then(async () => {
      await Promise.all([http.close(), server.close()]);
    });
    return closing;
  };
  const stop = () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdin.once('end', stop);
  server.server.onclose = stop;
  try {
    await server.connect(new StdioServerTransport());
    process.stderr.write(`Ainotation HTTP: ${http.url}\nAllowed origins: ${origins.join(', ')}\n`);
    process.stderr.write(
      process.env.AINOTATION_TOKEN === undefined
        ? `Pairing token: ${token}\n`
        : 'Pairing token: supplied by AINOTATION_TOKEN\n',
    );
  } catch (error) {
    await close();
    throw error;
  }
}

void main().catch((error: unknown) => {
  // Startup diagnostics omit request bodies and environment credentials.
  const code = (error as NodeJS.ErrnoException).code;
  process.stderr.write(
    code === 'EADDRINUSE'
      ? 'Ainotation startup failed: port already in use\n'
      : 'Ainotation startup failed: check arguments, token, origins, and store file\n',
  );
  process.exitCode = 1;
});
