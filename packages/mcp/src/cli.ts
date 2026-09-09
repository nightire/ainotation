#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './index';

const server = createMcpServer();

async function close() {
  await server.close();
  process.exitCode = 0;
}

process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
await server.connect(new StdioServerTransport());
