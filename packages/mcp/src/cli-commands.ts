import { parseArgs } from 'node:util';
import { discoverProject, initializeProject, ProjectError, type ProjectInfo } from './project';
import { readServiceConnection } from './shared-service';
import { lookupProject } from './project-registration';

type CliContext = {
  directory: string;
  output: (text: string) => void;
};

const HELP = `Usage: ainotation-mcp <command> [options]

Commands:
  init      Optional legacy identity-file setup (safe to repeat)
  project   Inspect the registered project without changing files
  server    Start the MCP/HTTP service
  service   Start the shared multi-project local service
  connect   Run workspace-scoped MCP with per-call project selection

Project options:
  --directory <path>   Start at this directory (default: current directory)
  --name <name>        Initial project name; init only, existing names are retained
  --json              Return machine-readable project information
  --data-dir <path>    Service directory for project inspection
  --help              Show command help

Running without a command keeps the existing server behavior.
Use "ainotation-mcp server --help" for server options.

Recommended Vite/Vite+ setup: add ainotation({ name: "your-project" }); optionally add a stable id.
No init command or ainotation.config.json is required for plugin-declared projects.
`;

function describeProject(project: ProjectInfo): string {
  const toolchain =
    project.toolchain.kind === 'vite-plus'
      ? 'Vite+'
      : project.toolchain.kind === 'vite'
        ? 'Vite'
        : 'Not detected';
  return `Project: ${project.config.name}
Project ID: ${project.config.projectId}
Root: ${project.root}
${project.configPath ? `Config: ${project.configPath}` : 'Identity: registered by Vite plugin'}
Toolchain: ${toolchain}
${project.toolchain.configFiles.length ? `Vite config: ${project.toolchain.configFiles.join(', ')}\n` : ''}`;
}

export async function runCli(
  args: string[],
  context: CliContext = {
    directory: process.cwd(),
    output: (text) => {
      process.stdout.write(text);
    },
  },
): Promise<void> {
  const [command, ...rest] = args;
  if (command === '--help' || command === '-h' || command === 'help') {
    context.output(HELP);
    return;
  }
  if (command === 'service') {
    const { startSharedServiceCommand } = await import('./service-command');
    await startSharedServiceCommand(rest);
    return;
  }
  if (command === 'connect') {
    const { startConnectCommand } = await import('./connect-command');
    await startConnectCommand(rest, context.directory);
    return;
  }
  if (!command || command === 'server' || command.startsWith('-')) {
    const { startServerCommand } = await import('./server-command');
    await startServerCommand(command === 'server' ? rest : args);
    return;
  }
  if (command !== 'init' && command !== 'project')
    throw new ProjectError('Unknown command. Use "ainotation-mcp --help".');
  let values;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        directory: { type: 'string' },
        ...(command === 'init' ? { name: { type: 'string' as const } } : {}),
        ...(command === 'project' ? { 'data-dir': { type: 'string' as const } } : {}),
        json: { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
    }));
  } catch (error) {
    throw new ProjectError('Invalid project command options. Use "ainotation-mcp --help".', {
      cause: error,
    });
  }
  if (values.help) {
    context.output(HELP);
    return;
  }
  const directory = values.directory ?? context.directory;
  if (command === 'init') {
    const result = await initializeProject({
      directory,
      ...(typeof values.name === 'string' ? { name: values.name } : {}),
    });
    context.output(
      values.json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `${result.created ? 'Created project identity.' : 'Using existing project identity.'}\n${describeProject(result)}
Commit ainotation.config.json with your project. It contains no connection credentials.
This command does not install dependencies or modify Vite or Agent MCP configuration.
For project-scoped MCP, configure your Agent to run ainotation-mcp connect --directory with this project root.
For new Vite/Vite+ projects, add ainotation({ name: "your-project", id: "optional-stable-key" }) instead of using this legacy file.
The plugin mounts the SDK and connects it to this project automatically during development.
`,
    );
  } else {
    const service = await readServiceConnection(
      typeof values['data-dir'] === 'string' ? values['data-dir'] : undefined,
    );
    const result = service
      ? await lookupProject(service, directory)
      : await discoverProject(directory);
    if (!result)
      throw new ProjectError(
        'This project is not initialized or registered. Start the Web app with ainotation({ name }) first.',
      );
    context.output(values.json ? `${JSON.stringify(result, null, 2)}\n` : describeProject(result));
  }
}
