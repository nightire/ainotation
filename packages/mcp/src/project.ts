import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, open, realpath, rm } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';

export const PROJECT_CONFIG_FILE = 'ainotation.config.json';
const MAX_CONFIG_BYTES = 64 * 1024;
const VITE_CONFIG_FILES = [
  'vite.config.ts',
  'vite.config.mts',
  'vite.config.cts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.cjs',
];

export const ProjectConfigSchema = z
  .object({
    version: z.literal(1),
    projectId: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine((value) => {
        for (let index = 0; index < value.length; index++) {
          const code = value.charCodeAt(index);
          if (code < 32 || code === 127) return false;
        }
        return true;
      }, 'Project name cannot contain control characters'),
  })
  .strict();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export const ProjectDeclarationSchema = z
  .object({
    name: ProjectConfigSchema.shape.name,
    id: ProjectConfigSchema.shape.name.optional(),
  })
  .strict();
export type ProjectDeclaration = z.infer<typeof ProjectDeclarationSchema>;
export type ProjectToolchain = {
  kind: 'vite' | 'vite-plus' | 'unknown';
  configFiles: string[];
};
export interface ProjectInfo {
  root: string;
  configPath?: string;
  config: ProjectConfig;
  toolchain: ProjectToolchain;
  declaration?: ProjectDeclaration;
}
export type ConfiguredProjectInfo = ProjectInfo & { configPath: string };

/** Deterministic, namespaced UUID; explicit UUIDs preserve earlier project identities. */
export function projectIdFor(key: string): string {
  const normalized = ProjectConfigSchema.shape.name.parse(key).normalize('NFC');
  if (z.uuid().safeParse(normalized).success) return normalized.toLowerCase();
  const bytes = createHash('sha256')
    .update('ainotation:project:v1\0')
    .update(normalized)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function declareProject(
  directory: string,
  input: ProjectDeclaration,
): Promise<ProjectInfo & { declaration: ProjectDeclaration }> {
  const declaration = ProjectDeclarationSchema.parse(input);
  const root = await canonicalProjectDirectory(directory);
  const { toolchain } = await inspectToolchain(root);
  return {
    root,
    declaration,
    config: {
      version: 1,
      projectId: projectIdFor(declaration.id ?? declaration.name),
      name: declaration.name,
    },
    toolchain,
  };
}

export class ProjectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProjectError';
  }
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return false;
    throw new ProjectError(`Cannot inspect ${basename(path)}. Check directory permissions.`, {
      cause: error,
    });
  }
}

async function readJson(path: string): Promise<unknown> {
  let file;
  try {
    file = await open(path, 'r');
  } catch (error) {
    if (hasCode(error, 'ENOENT')) {
      // A dangling symlink is an invalid existing config, not an absent file.
      if (!(await exists(path))) return undefined;
    }
    throw new ProjectError(`Cannot read ${basename(path)}. Check the file and its permissions.`, {
      cause: error,
    });
  }
  try {
    if (!(await file.stat()).isFile()) throw new Error('Expected a regular file');
    const buffer = Buffer.alloc(MAX_CONFIG_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > MAX_CONFIG_BYTES) throw new Error('Config too large');
    return JSON.parse(buffer.subarray(0, length).toString('utf8')) as unknown;
  } catch (error) {
    throw new ProjectError(`${basename(path)} must be a valid JSON file no larger than 64 KiB.`, {
      cause: error,
    });
  } finally {
    await file.close();
  }
}

export async function canonicalProjectDirectory(directory: string): Promise<string> {
  try {
    const start = await realpath(resolve(directory));
    if (!(await lstat(start)).isDirectory()) throw new Error('Expected a directory');
    return start;
  } catch (error) {
    throw new ProjectError('Project directory must be an existing readable directory.', {
      cause: error,
    });
  }
}

/** Nearest package/config wins; a nested Web app never inherits its parent's identity. */
export async function findProjectRoot(directory: string): Promise<string> {
  const start = await canonicalProjectDirectory(directory);
  let current = start;
  while (true) {
    const [config, manifest, git] = await Promise.all([
      exists(join(current, PROJECT_CONFIG_FILE)),
      exists(join(current, 'package.json')),
      exists(join(current, '.git')),
    ]);
    if (config || manifest || git) return current;
    const parent = dirname(current);
    if (parent === current) return start;
    current = parent;
  }
}

async function readConfig(root: string): Promise<ProjectConfig | undefined> {
  const input = await readJson(join(root, PROJECT_CONFIG_FILE));
  if (input === undefined) return undefined;
  const result = ProjectConfigSchema.safeParse(input);
  if (!result.success) {
    throw new ProjectError(
      `${PROJECT_CONFIG_FILE} must contain version 1, a UUID projectId and a nonempty name. Existing configuration was not changed.`,
    );
  }
  return result.data;
}

async function inspectToolchain(
  root: string,
): Promise<{ name?: string; toolchain: ProjectToolchain }> {
  const input = await readJson(join(root, 'package.json'));
  const parsed = z
    .object({
      name: z.string().optional(),
      dependencies: z.record(z.string(), z.string()).optional(),
      devDependencies: z.record(z.string(), z.string()).optional(),
      scripts: z.record(z.string(), z.string()).optional(),
    })
    .safeParse(input === undefined ? {} : input);
  if (!parsed.success)
    throw new ProjectError(
      'package.json contains invalid project metadata. Existing files were not changed.',
    );
  const manifest = parsed.data;
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const scripts = Object.values(manifest.scripts ?? {});
  const found = await Promise.all(
    VITE_CONFIG_FILES.map(async (name) => ((await exists(join(root, name))) ? name : undefined)),
  );
  const configFiles = found.filter((name): name is string => name !== undefined);
  const plus =
    'vite-plus' in dependencies ||
    scripts.some((script) => /(?:^|[\s;&|])vp\s+(?:dev|build|run)\b/.test(script));
  const vite =
    'vite' in dependencies ||
    configFiles.length > 0 ||
    scripts.some((script) => /(?:^|[\s;&|])vite(?:\s|$)/.test(script));
  return {
    ...(manifest.name ? { name: manifest.name } : {}),
    toolchain: { kind: plus ? 'vite-plus' : vite ? 'vite' : 'unknown', configFiles },
  };
}

/** Legacy file-based discovery. Plugin-declared projects are resolved from the service registry. */
export async function discoverProject(
  directory: string,
): Promise<ConfiguredProjectInfo | undefined> {
  const root = await findProjectRoot(directory);
  const config = await readConfig(root);
  if (!config) return undefined;
  const { toolchain } = await inspectToolchain(root);
  return { root, configPath: join(root, PROJECT_CONFIG_FILE), config, toolchain };
}

/** Only creates the identity file. Existing application and Agent configs are preserved. */
export async function initializeProject(options: {
  directory: string;
  name?: string;
}): Promise<ConfiguredProjectInfo & { created: boolean }> {
  const root = await findProjectRoot(options.directory);
  const configPath = join(root, PROJECT_CONFIG_FILE);
  const existing = await readConfig(root);
  const metadata = await inspectToolchain(root);
  if (existing)
    return { root, configPath, config: existing, toolchain: metadata.toolchain, created: false };
  const parsed = ProjectConfigSchema.safeParse({
    version: 1,
    projectId: randomUUID(),
    name: options.name ?? metadata.name ?? basename(root),
  });
  if (!parsed.success)
    throw new ProjectError(
      'Choose a project name with 1–200 characters and no control characters.',
    );
  const config = parsed.data;
  const temporary = join(root, `.ainotation-${randomUUID()}.tmp`);
  let ownsTemporary = false;
  try {
    const file = await open(temporary, 'wx', 0o644);
    ownsTemporary = true;
    try {
      await file.writeFile(`${JSON.stringify(config, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    // Publish only a complete file; two simultaneous initializers share the winner.
    try {
      await link(temporary, configPath);
    } catch (error) {
      if (!hasCode(error, 'EEXIST')) throw error;
      const winner = await readConfig(root);
      if (!winner)
        throw new ProjectError(
          'Project configuration changed during initialization. Run init again.',
        );
      return { root, configPath, config: winner, toolchain: metadata.toolchain, created: false };
    }
    return { root, configPath, config, toolchain: metadata.toolchain, created: true };
  } catch (error) {
    if (error instanceof ProjectError) throw error;
    throw new ProjectError('Cannot create project configuration. Check directory permissions.', {
      cause: error,
    });
  } finally {
    if (ownsTemporary) await rm(temporary, { force: true });
  }
}
