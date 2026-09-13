import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createProjectMcpServer } from './project-mcp';

export async function startConnectCommand(args: string[], cwd = process.cwd()) {
  const { values } = parseArgs({
    args,
    options: {
      directory: { type: 'string' },
      'data-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(
      'Usage: ainotation-mcp connect [--directory WEB_APP_OR_WORKSPACE] [--data-dir PATH]\nRuns workspace-scoped MCP over stdio and starts or reuses the shared local service.\nWithout --directory, use Agent workspace roots, or the startup directory when roots are unsupported.\nUse ainotation_list_projects to discover Web apps, then pass project by name or ID on annotation tools. A directory matching one Web app keeps the connection restricted to that app.\n',
    );
    return;
  }
  const bridge = createProjectMcpServer({
    cwd,
    ...(values.directory ? { directory: values.directory } : {}),
    ...(values['data-dir'] ? { serviceDirectory: values['data-dir'] } : {}),
  });
  const stop = () => {
    process.removeListener('SIGINT', stop);
    process.removeListener('SIGTERM', stop);
    process.stdin.removeListener('end', stop);
    void bridge.close().catch(() => {
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  process.stdin.once('end', stop);
  bridge.server.server.onclose = stop;
  try {
    await bridge.server.connect(new StdioServerTransport());
  } catch (error) {
    stop();
    throw error;
  }
}
