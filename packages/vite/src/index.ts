import { basename, dirname, resolve } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage } from 'node:http';
import { normalizePath, searchForWorkspaceRoot, type Plugin, type ViteDevServer } from 'vite';
import {
  declareProject,
  discoverProject,
  ProjectError,
  type ProjectInfo,
} from '@ainotation/mcp/project';
import { registerDevelopmentProject } from '@ainotation/mcp/registration';
import { createBrowserConnection } from '@ainotation/mcp/browser';
import { defaultServiceDirectory, serviceOwnerPaths } from '@ainotation/mcp/service';
import { createDevelopmentBridge } from './bridge';

export interface AinotationPluginOptions {
  /** Display name; also the stable project key when id is omitted. */
  name?: string;
  /** Optional stable key, allowing the display name to change independently. */
  id?: string;
  /** Defaults to the Web application containing Vite's root. */
  directory?: string;
  /** Shared local service state; omit for the user's default service. */
  serviceDirectory?: string;
  /** Advanced override; source and installed package layouts are detected automatically. */
  serviceCliPath?: string;
}
const VIRTUAL_ID = 'virtual:ainotation/client';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;

async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    const parent = dirname(path);
    return parent === path ? path : resolve(await canonicalPath(parent), basename(path));
  }
}

/** Development-only injection. The HTTP bridge owns credentials and streaming resources. */
export function ainotation(options: AinotationPluginOptions = {}): Plugin {
  let project: ProjectInfo | undefined;
  let server: ViteDevServer | undefined;
  let bridge: ReturnType<typeof createDevelopmentBridge> | undefined;
  let base = '/';
  let bridgePath = '/__ainotation';
  let closing: Promise<void> | undefined;
  let unwatch: (() => void) | undefined;
  const lifetime = new AbortController();
  const clientPath = fileURLToPath(
    new URL(import.meta.url.endsWith('.ts') ? './client.ts' : './client.mjs', import.meta.url),
  );
  const sdkPath = fileURLToPath(import.meta.resolve('@ainotation/sdk'));
  const close = (): Promise<void> => {
    closing ??= (async () => {
      lifetime.abort();
      unwatch?.();
      unwatch = undefined;
      await bridge?.close();
    })();
    return closing;
  };
  function originFor(request: IncomingMessage, boundOrigin?: string): string | undefined {
    if (!server) return;
    const scheme = server.config.server.https ? 'https:' : 'http:';
    const candidates = [
      ...(server.resolvedUrls?.local ?? []),
      ...(server.resolvedUrls?.network ?? []),
    ];
    const address = server.httpServer?.address();
    if (address && typeof address !== 'string')
      candidates.push(
        `${scheme}//127.0.0.1:${address.port}`,
        `${scheme}//localhost:${address.port}`,
        `${scheme}//[::1]:${address.port}`,
      );
    if (server.config.server.origin) candidates.push(server.config.server.origin);
    return candidates
      .map((value) => new URL(value).origin)
      .find(
        (value) =>
          new URL(value).host === request.headers.host &&
          (boundOrigin === undefined || value === boundOrigin) &&
          (request.headers.origin === undefined || request.headers.origin === value),
      );
  }
  return {
    name: 'ainotation',
    apply: 'serve',
    async config(config) {
      const directory = resolve(options.serviceDirectory ?? defaultServiceDirectory());
      const canonical = await canonicalPath(directory);
      const runtimeDirectory = serviceOwnerPaths(canonical).root;
      const canonicalRuntime = await canonicalPath(runtimeDirectory);
      return {
        server: {
          fs: {
            // Configure before Vite compiles its deny matcher. Mutating this in
            // configResolved is too late on platforms without path aliasing.
            deny: [
              ...(config.server?.fs?.deny ?? [
                '.env',
                '.env.*',
                '*.{crt,pem,key,p12,pfx,cer,der}',
                '.npmrc',
                '.yarnrc.yml',
                '**/.git/**',
              ]),
              `${normalizePath(directory)}/**`,
              `${normalizePath(canonical)}/**`,
              `${normalizePath(runtimeDirectory)}/**`,
              `${normalizePath(canonicalRuntime)}/**`,
            ],
            allow: [
              ...(config.server?.fs?.allow ?? [
                searchForWorkspaceRoot(config.root ?? process.cwd()),
              ]),
              dirname(clientPath),
              dirname(sdkPath),
            ],
          },
        },
      };
    },
    async configureServer(vite) {
      server = vite;
      base = vite.config.base;
      bridgePath = `${base}__ainotation`;
      const root = options.directory
        ? resolve(vite.config.root, options.directory)
        : vite.config.root;
      project =
        options.name !== undefined || options.id !== undefined
          ? await declareProject(root, {
              name: options.name!,
              ...(options.id !== undefined ? { id: options.id } : {}),
            })
          : await discoverProject(root);
      if (!project)
        throw new Error(
          'Configure ainotation({ name: "your-project" }) in Vite. An optional id keeps identity stable when renaming.',
        );
      const currentProject = project;
      bridge = createDevelopmentBridge({
        project,
        path: bridgePath,
        originFor,
        createConnection: (origin) =>
          createBrowserConnection({
            project: currentProject,
            origin,
            ...(options.serviceDirectory ? { serviceDirectory: options.serviceDirectory } : {}),
            ...(options.serviceCliPath ? { cliPath: options.serviceCliPath } : {}),
          }),
      });
      vite.httpServer?.once('close', () => {
        void close();
      });
      try {
        await registerDevelopmentProject(project, {
          ...(options.serviceDirectory ? { serviceDirectory: options.serviceDirectory } : {}),
          ...(options.serviceCliPath ? { cliPath: options.serviceCliPath } : {}),
          signal: lifetime.signal,
        });
      } catch (error) {
        if (
          error instanceof Error &&
          'status' in error &&
          [400, 409].includes(Number(error.status))
        ) {
          await close();
          throw new Error(
            'Ainotation project registration conflicts with existing data. Use a unique name/id and preserve the original id when renaming.',
            { cause: error },
          );
        }
        if (error instanceof ProjectError) vite.config.logger.warn(`Ainotation: ${error.message}`);
        else
          vite.config.logger.warn(
            'Ainotation shared service is unavailable. Local annotations remain available; connection will retry when the page opens.',
          );
      }
      if (lifetime.signal.aborted) return;
      if (project.configPath) {
        vite.watcher.add(project.configPath);
        const onProjectChange = (path: string) => {
          if (!lifetime.signal.aborted && resolve(path) === currentProject.configPath) {
            void close();
            vite.config.logger.warn(
              'Ainotation project configuration changed. Restart the dev server.',
            );
          }
        };
        // Initial discovery emits "add" for an existing config and is not a change.
        for (const event of ['change', 'unlink'] as const) vite.watcher.on(event, onProjectChange);
        unwatch = () => {
          for (const event of ['change', 'unlink'] as const)
            vite.watcher.off(event, onProjectChange);
        };
      }
      const handler = bridge;
      vite.middlewares.use((request, response, next) => {
        const path = request.url ?? '';
        if (path !== bridgePath && !path.startsWith(`${bridgePath}/`)) {
          next();
          return;
        }
        void (async () => {
          if (currentProject.configPath && !lifetime.signal.aborted) {
            try {
              const identity = await discoverProject(currentProject.root);
              if (
                !identity ||
                identity.root !== currentProject.root ||
                identity.config.projectId !== currentProject.config.projectId ||
                identity.config.name !== currentProject.config.name
              )
                await close();
            } catch {
              await close();
            }
          }
          await handler.handle(request, response, path.slice(bridgePath.length));
        })().catch(() => response.destroy());
      });
    },
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID || !project) return;
      const config = {
        projectId: project.config.projectId,
        projectName: project.config.name,
        bridge: bridgePath,
      };
      return `import { mountDevelopmentInspector } from ${JSON.stringify(normalizePath(clientPath))};\nconst dispose = mountDevelopmentInspector(${JSON.stringify(config)});\nif (import.meta.hot) import.meta.hot.dispose(dispose);`;
    },
    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { type: 'module', src: `${base}@id/__x00__${VIRTUAL_ID}` },
          injectTo: 'body',
        },
      ];
    },
    closeBundle: close,
  };
}
