import { ensureSharedService } from './service-discovery';
import { ProjectError, type ProjectInfo } from './project';
import { registerProject } from './project-registration';
import { StoreError } from './store';
import { createLeaseClient } from './lease-client';

/** A dev-server-owned grant: root credentials and renewals never enter the page. */
export function createBrowserConnection(options: {
  project: ProjectInfo;
  origin: string;
  serviceDirectory?: string;
  cliPath?: string;
}) {
  const leases = createLeaseClient({
    request: {
      kind: 'browser',
      projectId: options.project.config.projectId,
      origin: options.origin,
    },
    getService: (signal) =>
      ensureSharedService({
        ...(options.serviceDirectory ? { directory: options.serviceDirectory } : {}),
        ...(options.cliPath ? { cliPath: options.cliPath } : {}),
        signal,
      }),
    prepare: (service, signal) => registerProject(service, options.project, signal),
    revokedMessage: 'Development connection was revoked. Restart the dev server to reconnect.',
  });
  return {
    async connect() {
      await leases.get();
    },
    async fetch(
      path: string,
      request: {
        method: 'GET' | 'POST';
        body?: string | Uint8Array<ArrayBuffer>;
        signal: AbortSignal;
      },
    ): Promise<Response> {
      if (
        !(path === '/health' && request.method === 'GET') &&
        !/^\/sessions\/[a-f0-9-]+\/(sync|events|images\/[a-f0-9-]+)$/i.test(path)
      )
        throw new ProjectError('Invalid browser proxy path');
      request.signal.throwIfAborted();
      const connection = await leases.get();
      try {
        const response = await fetch(`${connection.service.url}${path}`, {
          method: request.method,
          headers: {
            Authorization: `Bearer ${connection.grant.token}`,
            Origin: options.origin,
            ...(request.body === undefined
              ? {}
              : {
                  'Content-Type':
                    typeof request.body === 'string' ? 'application/json' : 'image/png',
                }),
          },
          ...(request.body === undefined ? {} : { body: request.body }),
          signal: AbortSignal.any([leases.signal, request.signal]),
          redirect: 'error',
          credentials: 'omit',
        });
        if ([401, 403, 503].includes(response.status))
          leases.invalidate(
            connection,
            new StoreError(response.status, 'Development connection unavailable'),
          );
        return response;
      } catch (error) {
        if (!request.signal.aborted && !leases.signal.aborted) leases.invalidate(connection, error);
        throw error;
      }
    },
    close: () => leases.close(),
  };
}
