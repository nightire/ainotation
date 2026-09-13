import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { z } from 'zod';
import { createFeedbackStore, StoreError, type FeedbackStore } from './store';
import {
  declareProject,
  canonicalProjectDirectory,
  discoverProject,
  findProjectRoot,
  ProjectConfigSchema,
  ProjectError,
  type ProjectDeclaration,
} from './project';
import { writePrivateJson } from './atomic-json';
import { isExactOrigin, tokenDigest } from './http-common';

const RegisteredProjectSchema = ProjectConfigSchema.extend({
  root: z.string().min(1).refine(isAbsolute),
}).strict();
const RegistrySchema = z
  .object({ version: z.literal(1), projects: z.array(RegisteredProjectSchema).max(100) })
  .strict();
export type RegisteredProject = z.infer<typeof RegisteredProjectSchema>;
export const GrantRequestSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('browser'),
      projectId: z.uuid(),
      origin: z.string().refine(isExactOrigin),
    })
    .strict(),
  z.object({ kind: z.literal('agent'), projectId: z.uuid() }).strict(),
]);
export type GrantRequest = z.infer<typeof GrantRequestSchema>;
export type ProjectGrant = GrantRequest & { grantId: string; expiresAt: number };
type GrantState = { grant: ProjectGrant; digest: string; controller: AbortController };
export type IssuedGrant = ProjectGrant & { token: string };
export interface AuthorizedProject {
  grant: ProjectGrant;
  project: RegisteredProject;
  store: FeedbackStore;
  signal: AbortSignal;
}

export async function createProjectService(options: {
  directory: string;
  leaseMs?: number;
  now?: () => number;
}) {
  const { directory, leaseMs = 5 * 60 * 1000, now = Date.now } = options;
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error('Lease duration must be positive');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const registryPath = join(directory, 'projects.json');
  let stored: RegisteredProject[] = [];
  try {
    stored = RegistrySchema.parse(JSON.parse(await readFile(registryPath, 'utf8'))).projects;
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
  }
  const projects = new Map<string, RegisteredProject>();
  for (const project of stored) {
    if (
      projects.has(project.projectId) ||
      [...projects.values()].some((item) => item.root === project.root)
    )
      throw new Error('Invalid project registry');
    projects.set(project.projectId, project);
  }
  const stores = new Map<string, Promise<FeedbackStore>>();
  const grants = new Map<string, GrantState>();
  const byDigest = new Map<string, GrantState>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const requireOpen = () => {
    if (closed) throw new StoreError(503, 'Service is closing');
  };
  function projectById(id: string) {
    const project = projects.get(z.uuid().parse(id));
    if (!project) throw new StoreError(404, 'Project not registered');
    return project;
  }
  async function resolveProject(directory: string): Promise<RegisteredProject | undefined> {
    requireOpen();
    const root = await canonicalProjectDirectory(directory);
    const exact = [...projects.values()].find((project) => project.root === root);
    if (exact) return structuredClone(exact);
    const within = (parent: string, child: string) => {
      const path = relative(parent, child);
      return path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path);
    };
    const boundary = await findProjectRoot(root);
    const parents = [...projects.values()]
      .filter((project) => within(boundary, project.root) && within(project.root, root))
      .sort((a, b) => b.root.length - a.root.length);
    if (parents[0]) return structuredClone(parents[0]);
    const children = [...projects.values()].filter((project) => within(root, project.root));
    if (children.length > 1)
      throw new StoreError(
        409,
        'Workspace contains multiple registered Web projects. Configure --directory to the intended app.',
      );
    return children[0] ? structuredClone(children[0]) : undefined;
  }
  function revoke(grantId: string): void {
    const state = grants.get(grantId);
    if (!state) return;
    grants.delete(grantId);
    byDigest.delete(state.digest);
    state.controller.abort();
  }
  function expire(): void {
    for (const [id, state] of grants) if (state.grant.expiresAt <= now()) revoke(id);
  }
  function storeFor(projectId: string): Promise<FeedbackStore> {
    projectById(projectId);
    let opening = stores.get(projectId);
    if (!opening) {
      opening = createFeedbackStore({
        filePath: join(directory, 'projects', projectId, 'feedback.json'),
      });
      stores.set(projectId, opening);
      void opening.catch(() => {
        if (stores.get(projectId) === opening) stores.delete(projectId);
      });
    }
    return opening;
  }
  function verify(authorization: string | undefined, origin: string | undefined): GrantState {
    requireOpen();
    expire();
    const state = authorization?.startsWith('Bearer ')
      ? byDigest.get(tokenDigest(authorization.slice(7)).toString('hex'))
      : undefined;
    if (!state) throw new StoreError(401, 'Unauthorized');
    if (state.grant.kind === 'browser' ? origin !== state.grant.origin : origin !== undefined)
      throw new StoreError(403, 'Origin not allowed for this connection');
    return state;
  }

  return {
    listGrants(): ProjectGrant[] {
      requireOpen();
      expire();
      return structuredClone([...grants.values()].map((state) => state.grant));
    },
    listProjects() {
      requireOpen();
      return structuredClone([...projects.values()]);
    },
    resolveProject,
    async register(
      directory: string,
      declaration?: ProjectDeclaration,
    ): Promise<RegisteredProject> {
      requireOpen();
      let discovered;
      try {
        discovered = declaration
          ? await declareProject(directory, declaration)
          : await discoverProject(directory);
        if (!discovered) {
          const registered = await resolveProject(directory);
          if (registered) return registered;
        }
      } catch (error) {
        if (error instanceof ProjectError) throw new StoreError(400, error.message);
        throw error;
      }
      if (!discovered)
        throw new StoreError(
          400,
          'Start the Web project with ainotation({ name }) before connecting MCP.',
        );
      const project = RegisteredProjectSchema.parse({
        ...discovered.config,
        root: discovered.root,
      });
      const work = queue.then(async () => {
        requireOpen();
        const existing = projects.get(project.projectId);
        if (existing && existing.root !== project.root)
          throw new StoreError(409, 'Project ID is already registered to a different root');
        if (
          [...projects.values()].some(
            (item) => item.root === project.root && item.projectId !== project.projectId,
          )
        )
          throw new StoreError(409, 'Project root is already registered with a different identity');
        if (existing && existing.name === project.name) return structuredClone(existing);
        if (!existing && projects.size >= 100)
          throw new StoreError(409, 'Project capacity reached');
        const next = new Map(projects).set(project.projectId, project);
        await writePrivateJson(registryPath, { version: 1, projects: [...next.values()] });
        projects.set(project.projectId, project);
        return structuredClone(project);
      });
      queue = work.catch(() => {});
      return work;
    },
    issue(input: GrantRequest): IssuedGrant {
      requireOpen();
      expire();
      const request = GrantRequestSchema.parse(input);
      projectById(request.projectId);
      if (grants.size >= 256) throw new StoreError(409, 'Connection capacity reached');
      const token = randomBytes(32).toString('hex');
      const grant = { ...request, grantId: randomUUID(), expiresAt: now() + leaseMs };
      const state = {
        grant,
        digest: tokenDigest(token).toString('hex'),
        controller: new AbortController(),
      };
      grants.set(grant.grantId, state);
      byDigest.set(state.digest, state);
      return { ...grant, token };
    },
    renew(grantId: string): ProjectGrant {
      requireOpen();
      expire();
      const state = grants.get(z.uuid().parse(grantId));
      if (!state) throw new StoreError(404, 'Connection expired or revoked');
      state.grant.expiresAt = now() + leaseMs;
      return structuredClone(state.grant);
    },
    revoke(grantId: string) {
      requireOpen();
      revoke(z.uuid().parse(grantId));
    },
    allowsOrigin(origin: string) {
      expire();
      return (
        !closed &&
        [...grants.values()].some(
          (state) => state.grant.kind === 'browser' && state.grant.origin === origin,
        )
      );
    },
    async authorize(
      authorization: string | undefined,
      origin?: string,
    ): Promise<AuthorizedProject> {
      const state = verify(authorization, origin);
      const store = await storeFor(state.grant.projectId);
      verify(authorization, origin);
      return {
        grant: structuredClone(state.grant),
        project: structuredClone(projectById(state.grant.projectId)),
        store,
        signal: state.controller.signal,
      };
    },
    expire,
    async close() {
      closed = true;
      for (const id of grants.keys()) revoke(id);
      await queue;
      await Promise.all([...stores.values()].map(async (opening) => (await opening).flush()));
    },
  };
}

export type ProjectService = Awaited<ReturnType<typeof createProjectService>>;
