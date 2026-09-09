import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { feedbackJsonSchema } from '@ainotation/schema';
import { expect, it } from 'vite-plus/test';
import { createMcpServer } from './index';

it('serves the shared contract over MCP without opening an HTTP port', async () => {
  const server = createMcpServer();
  const client = new Client({ name: 'ainotation-test', version: '0.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'ainotation_get_schema',
    ]);
    const response = await client.callTool({ name: 'ainotation_get_schema', arguments: {} });
    expect(response.isError).not.toBe(true);
    expect(response.content).toEqual([
      { type: 'text', text: JSON.stringify(feedbackJsonSchema()) },
    ]);
  } finally {
    await client.close();
    await server.close();
  }
});
