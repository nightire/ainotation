import { feedbackJsonSchema } from '@ainotation/schema';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: 'ainotation', version: '0.0.0' });
  server.registerTool(
    'ainotation_get_schema',
    {
      description: 'Return the current Ainotation feedback document schema.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    () => ({ content: [{ type: 'text' as const, text: JSON.stringify(feedbackJsonSchema()) }] }),
  );
  return server;
}
