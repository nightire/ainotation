import { z } from 'zod';
import { ProjectError, projectIdFor, type ProjectInfo } from './project';

export const ProjectSelectorSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe(
    'Project name, plugin id, or project UUID within the current workspace. Required when multiple projects are available.',
  );
export const projectSummary = (project: ProjectInfo) => ({ ...project.config, root: project.root });

export class ProjectChoiceError extends ProjectError {
  readonly projects: ReturnType<typeof projectSummary>[];
  constructor(message: string, projects: ProjectInfo[]) {
    super(message);
    this.projects = projects.map(projectSummary);
  }
}

export function chooseProject(projects: ProjectInfo[], selector?: string): ProjectInfo {
  if (!projects.length)
    throw new ProjectChoiceError(
      'No projects are registered in this workspace yet. Start the Web app with ainotation({ name }) and retry.',
      [],
    );
  if (selector === undefined) {
    if (projects.length === 1) return projects[0]!;
    throw new ProjectChoiceError(
      'Multiple projects are available. Pass project with a name or ID from the candidates.',
      projects,
    );
  }
  const key = ProjectSelectorSchema.parse(selector).normalize('NFC');
  // UUIDs are unambiguous even if another app happens to use one as its display name.
  const byId = projects.find((project) => project.config.projectId === key.toLowerCase());
  if (byId) return byId;
  let derived: string | undefined;
  try {
    derived = projectIdFor(key);
  } catch {
    /* Invalid stable keys cannot match a project. */
  }
  const matches = projects.filter(
    (project) =>
      project.config.name.normalize('NFC') === key || project.config.projectId === derived,
  );
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 1)
    throw new ProjectChoiceError(
      'Project name is ambiguous. Pass the project UUID from the candidates.',
      matches,
    );
  throw new ProjectChoiceError(
    'Requested project is not available in this workspace. Choose one of the candidates.',
    projects,
  );
}
