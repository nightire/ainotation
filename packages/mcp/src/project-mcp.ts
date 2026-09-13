import { RootsListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { createMcpServer } from './index';
import { createProjectBinding } from './project-binding';
import { createProjectConnection } from './project-connection';
import { ProjectError, type ProjectInfo } from './project';
import type { ServiceConnection } from './shared-service';
import { ensureSharedService } from './service-discovery';
import { lookupWorkspaceProjects } from './project-registration';
import { chooseProject, ProjectSelectorSchema, projectSummary } from './project-choice';
import { toolResponse } from './mcp-result';

export function createProjectMcpServer(
  options: {
    directory?: string;
    cwd?: string;
    serviceDirectory?: string;
    cliPath?: string;
    getService?: (signal: AbortSignal) => Promise<ServiceConnection>;
  } = {},
) {
  const lifetime = new AbortController();
  const connections = new Map<
    string,
    { project: ProjectInfo; connection: ReturnType<typeof createProjectConnection> }
  >();
  const getService = (signal: AbortSignal) =>
    options.getService
      ? options.getService(signal)
      : ensureSharedService({
          ...(options.serviceDirectory ? { directory: options.serviceDirectory } : {}),
          ...(options.cliPath ? { cliPath: options.cliPath } : {}),
          signal,
        });
  let connectionsClosing: Promise<void> | undefined;
  const closeConnections = () => {
    lifetime.abort();
    connectionsClosing ??= Promise.all(
      [...connections.values()].map((entry) => entry.connection.close()),
    ).then(() => {
      connections.clear();
    });
    return connectionsClosing;
  };
  const binding = createProjectBinding({
    ...(options.directory ? { directory: options.directory } : {}),
    cwd: options.cwd ?? process.cwd(),
    onInvalidated() {
      void closeConnections();
    },
    async lookup(directory, exact) {
      return lookupWorkspaceProjects(
        await getService(lifetime.signal),
        directory,
        exact,
        lifetime.signal,
      );
    },
    async roots() {
      if (!server.server.getClientCapabilities()?.roots) return undefined;
      try {
        return (await server.server.listRoots(undefined, { timeout: 3000 })).roots;
      } catch (error) {
        throw new ProjectError(
          'Cannot determine the Agent workspace roots. Configure --directory explicitly.',
          { cause: error },
        );
      }
    },
  });
  const assertActive = () => {
    if (lifetime.signal.aborted)
      throw new ProjectError(
        'Workspace connection is closed or its roots changed. Reconnect Ainotation MCP.',
      );
  };
  let discoveryVersion = 0;
  async function projectsInScope() {
    assertActive();
    const version = ++discoveryVersion;
    const projects = await binding.list();
    assertActive();
    if (version === discoveryVersion) {
      const removed = [...connections].filter(
        ([id, entry]) =>
          !projects.some(
            (project) => project.config.projectId === id && project.root === entry.project.root,
          ),
      );
      for (const [id] of removed) connections.delete(id);
      await Promise.all(removed.map(([, entry]) => entry.connection.close()));
    }
    assertActive();
    return projects;
  }
  async function connectionFor(selector?: string) {
    const project = chooseProject(await projectsInScope(), selector);
    assertActive();
    let entry = connections.get(project.config.projectId);
    if (entry) {
      if (entry.project.root !== project.root)
        throw new ProjectError('Project root changed. Reconnect Ainotation MCP.');
      entry.project = project;
    } else {
      // Each entry owns one immutable project grant; there is no shared current project.
      const state = { project };
      const connection = createProjectConnection({
        resolveProject: async () => state.project,
        getService,
      });
      entry = Object.assign(state, { connection });
      connections.set(project.config.projectId, entry);
    }
    return entry.connection;
  }
  const server = createMcpServer(async (project) => (await connectionFor(project)).backend);
  server.server.onclose = () => {
    void closeConnections();
  };
  const annotations = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
  server.registerTool(
    'ainotation_list_projects',
    {
      description:
        'List registered Web apps available in this workspace. Use a name or project ID as the project parameter on annotation tools; other workspaces are excluded.',
      inputSchema: z.object({}).strict(),
      annotations,
    },
    () =>
      toolResponse(async () => {
        assertActive();
        const projects = await projectsInScope();
        assertActive();
        return { projects: projects.map(projectSummary) };
      }),
  );
  server.registerTool(
    'ainotation_get_project',
    {
      description:
        'Get a project by name or ID within this workspace. Automatically selects when only one project is available; otherwise returns candidates and requires project.',
      inputSchema: z.object({ project: ProjectSelectorSchema.optional() }).strict(),
      annotations,
    },
    ({ project }) => toolResponse(async () => (await connectionFor(project)).project()),
  );
  server.server.setNotificationHandler(RootsListChangedNotificationSchema, () => {
    binding.invalidate();
  });
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= Promise.resolve().then(async () => {
      await Promise.all([closeConnections(), server.close()]);
    });
    return closing;
  };
  return { server, close };
}
