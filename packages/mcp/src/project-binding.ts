import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {
  canonicalProjectDirectory,
  discoverProject,
  ProjectError,
  type ProjectInfo,
} from './project';
import { chooseProject } from './project-choice';

export function createProjectBinding(options: {
  directory?: string;
  cwd: string;
  roots?: () => Promise<{ uri: string }[] | undefined>;
  lookup?: (directory: string, exact: boolean) => Promise<ProjectInfo[]>;
  onInvalidated?: () => void;
}) {
  let boundRoots: string[] | undefined;
  let invalidated = false;
  const assertActive = () => {
    if (invalidated)
      throw new ProjectError(
        'Workspace roots changed. Reconnect Ainotation MCP or configure an explicit --directory.',
      );
  };
  function invalidate() {
    if (options.directory || !boundRoots || invalidated) return false;
    invalidated = true;
    options.onInvalidated?.();
    return true;
  }
  async function list(): Promise<ProjectInfo[]> {
    assertActive();
    let directories: string[];
    if (options.directory) directories = [resolve(options.cwd, options.directory)];
    else {
      const roots = await options.roots?.();
      if (roots === undefined) directories = [options.cwd];
      else {
        if (!roots.length || roots.length > 32)
          throw new ProjectError(
            'Provide local workspace roots or configure --directory explicitly.',
          );
        try {
          directories = roots.map((root) => fileURLToPath(root.uri));
        } catch {
          throw new ProjectError(
            'Workspace roots must be local file URLs. Configure --directory explicitly.',
          );
        }
      }
    }
    const roots = [
      ...new Set(await Promise.all(directories.map(canonicalProjectDirectory))),
    ].sort();
    assertActive();
    if (boundRoots && JSON.stringify(boundRoots) !== JSON.stringify(roots)) {
      invalidated = true;
      options.onInvalidated?.();
      throw new ProjectError(
        'Workspace roots changed. Reconnect Ainotation MCP to use the new workspace.',
      );
    }
    boundRoots = roots;
    const lists = await Promise.all(
      roots.map(async (directory) => {
        if (options.lookup) return options.lookup(directory, !!options.directory);
        const project = await discoverProject(directory);
        return project ? [project] : [];
      }),
    );
    assertActive();
    const unique = new Map<string, ProjectInfo>();
    for (const project of lists.flat()) {
      const known = unique.get(project.config.projectId);
      if (known && known.root !== project.root)
        throw new ProjectError('Project ID is associated with conflicting workspace directories.');
      unique.set(project.config.projectId, project);
    }
    return [...unique.values()].sort(
      (a, b) => a.config.name.localeCompare(b.config.name) || a.root.localeCompare(b.root),
    );
  }
  return {
    list,
    invalidate,
    async resolve(selector?: string) {
      return chooseProject(await list(), selector);
    },
  };
}
