import { z } from 'zod';
import {
  canonicalProjectDirectory,
  discoverProject,
  findProjectRoot,
  ProjectConfigSchema,
  ProjectError,
  type ProjectInfo,
} from './project';
import { isAbsolute, relative, sep } from 'node:path';
import { ensureSharedService } from './service-discovery';
import { serviceRequest } from './service-client';
import type { ServiceConnection } from './shared-service';
import { StoreError } from './store';

const RegisteredSchema = ProjectConfigSchema.extend({ root: z.string().min(1) });

async function requireProjectRegistry(connection: ServiceConnection, signal?: AbortSignal) {
  const response = await serviceRequest(connection, '/control/health', signal ? { signal } : {});
  const health = z
    .object({
      instanceId: z.uuid(),
      capabilities: z.object({ projectDeclarations: z.literal(true) }),
    })
    .safeParse(response);
  if (!health.success || health.data.instanceId !== connection.instanceId)
    throw new ProjectError(
      'The running shared service needs an update. Run ainotation-mcp service --stop with the same data directory, then restart the dev server.',
    );
}

export async function registerProject(
  connection: ServiceConnection,
  project: ProjectInfo,
  signal?: AbortSignal,
) {
  await requireProjectRegistry(connection, signal);
  if (!project.declaration) {
    try {
      const registered = RegisteredSchema.parse(
        await serviceRequest(connection, '/control/projects/resolve', {
          method: 'POST',
          body: { directory: project.root },
          ...(signal ? { signal } : {}),
        }),
      );
      if (registered.projectId !== project.config.projectId || registered.root !== project.root)
        throw new ProjectError('Project identity changed. Reconnect to the intended project.');
      return registered;
    } catch (error) {
      if (!(error instanceof StoreError && error.status === 404)) throw error;
    }
  }
  const registered = RegisteredSchema.parse(
    await serviceRequest(connection, '/control/projects', {
      method: 'POST',
      body: {
        directory: project.root,
        ...(project.declaration ? { declaration: project.declaration } : {}),
      },
      ...(signal ? { signal } : {}),
    }),
  );
  if (registered.projectId !== project.config.projectId || registered.root !== project.root)
    throw new ProjectError(
      'Project identity changed. Keep a stable plugin id or reconnect to the intended project.',
    );
  return registered;
}

export async function registerDevelopmentProject(
  project: ProjectInfo,
  options: { serviceDirectory?: string; cliPath?: string; signal?: AbortSignal } = {},
) {
  const connection = await ensureSharedService({
    ...(options.serviceDirectory ? { directory: options.serviceDirectory } : {}),
    ...(options.cliPath ? { cliPath: options.cliPath } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
  });
  return registerProject(connection, project, options.signal);
}

export async function lookupProject(
  connection: ServiceConnection,
  directory: string,
  signal?: AbortSignal,
): Promise<ProjectInfo | undefined> {
  await requireProjectRegistry(connection, signal);
  try {
    const project = RegisteredSchema.parse(
      await serviceRequest(connection, '/control/projects/resolve', {
        method: 'POST',
        body: { directory },
        ...(signal ? { signal } : {}),
      }),
    );
    const { root, ...config } = project;
    return { root, config, toolchain: { kind: 'unknown', configFiles: [] } };
  } catch (error) {
    if (error instanceof StoreError && error.status === 404) {
      const legacy = await discoverProject(directory);
      if (legacy) {
        await registerProject(connection, legacy, signal);
        return legacy;
      }
      return undefined;
    }
    if (error instanceof StoreError && error.status === 409)
      throw new ProjectError(
        'Workspace contains multiple Web projects. Configure --directory to the intended app.',
      );
    throw error;
  }
}

/** Return only reachable project metadata; the MCP layer never lists other local workspaces. */
export async function lookupWorkspaceProjects(
  connection: ServiceConnection,
  directory: string,
  exact = false,
  signal?: AbortSignal,
): Promise<ProjectInfo[]> {
  await requireProjectRegistry(connection, signal);
  const root = await canonicalProjectDirectory(directory);
  const registered = z
    .object({ projects: z.array(RegisteredSchema).max(100) })
    .parse(
      await serviceRequest(connection, '/control/projects', signal ? { signal } : {}),
    ).projects;
  const within = (parent: string, child: string) => {
    const path = relative(parent, child);
    return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
  };
  const exactProject = exact ? registered.find((project) => project.root === root) : undefined;
  let candidates = exactProject
    ? [exactProject]
    : registered.filter((project) => within(root, project.root));
  if (!candidates.length) {
    const boundary = await findProjectRoot(root);
    const parents = registered
      .filter((project) => within(boundary, project.root) && within(project.root, root))
      .sort((a, b) => b.root.length - a.root.length);
    if (parents[0]) candidates = [parents[0]];
  }
  const verified = await Promise.all(
    candidates.map(async (project) => {
      try {
        // A directory replaced with a symlink must not expand the workspace's scope.
        if ((await canonicalProjectDirectory(project.root)) !== project.root) return undefined;
      } catch {
        return undefined;
      }
      const { root, ...config } = project;
      return { root, config, toolchain: { kind: 'unknown' as const, configFiles: [] } };
    }),
  );
  const projects = verified.filter((project): project is NonNullable<typeof project> => !!project);
  if (projects.length || candidates.length) return projects;
  const legacy = await discoverProject(root);
  if (!legacy) return [];
  // Preserve the original single-app SDK setup without importing Vite configuration.
  const boundary = await findProjectRoot(root);
  if (!within(boundary, legacy.root)) return [];
  await registerProject(connection, legacy, signal);
  return [legacy];
}
