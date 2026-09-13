import { FeedbackExportSchema } from '@ainotation/schema';
import { z } from 'zod';
import type { McpFeedbackBackend } from './index';
import { ProjectError, type ProjectInfo } from './project';
import { registerProject } from './project-registration';
import { StoreError } from './store';
import type { ServiceConnection } from './shared-service';
import { ensureSharedService } from './service-discovery';
import { serviceRequest } from './service-client';
import { createLeaseClient, type LeaseClient } from './lease-client';

export function createProjectConnection(options: {
  resolveProject: () => Promise<ProjectInfo>;
  serviceDirectory?: string;
  cliPath?: string;
  getService?: (signal: AbortSignal) => Promise<ServiceConnection>;
}) {
  let leases: LeaseClient | undefined;
  let binding: ProjectInfo | undefined;
  let closed = false;
  const active = () => {
    if (closed) throw new ProjectError('Project MCP connection is closed.');
  };
  async function lease() {
    active();
    const project = await options.resolveProject();
    active();
    if (
      binding &&
      (binding.root !== project.root || binding.config.projectId !== project.config.projectId)
    )
      throw new ProjectError(
        'MCP connection cannot switch projects. Reconnect with the intended directory.',
      );
    binding = project;
    leases ??= createLeaseClient({
      request: { kind: 'agent', projectId: project.config.projectId },
      getService: (signal) =>
        options.getService
          ? options.getService(signal)
          : ensureSharedService({
              ...(options.serviceDirectory ? { directory: options.serviceDirectory } : {}),
              ...(options.cliPath ? { cliPath: options.cliPath } : {}),
              signal,
            }),
      prepare: (service, signal) => registerProject(service, project, signal),
      revokedMessage:
        'Project authorization was revoked. Reconnect Ainotation MCP to authorize a new connection.',
    });
    const connection = await leases.get();
    active();
    return { connection, client: leases, project };
  }
  async function request(path: string, method = 'GET', body?: unknown) {
    const { connection, client } = await lease();
    try {
      return await serviceRequest(connection.service, path, {
        method,
        ...(body === undefined ? {} : { body }),
        token: connection.grant.token,
        signal: client.signal,
      });
    } catch (error) {
      if (!(error instanceof StoreError) || [401, 403, 503].includes(error.status))
        client.invalidate(connection, error);
      if (error instanceof StoreError || error instanceof ProjectError) throw error;
      throw new ProjectError(
        'Shared service connection was interrupted. Retry the operation to reconnect.',
        { cause: error },
      );
    }
  }
  const sessionPath = (id: string) => `/sessions/${z.uuid().parse(id)}`;
  const annotationPath = (sessionId: string, annotationId: string) =>
    `${sessionPath(sessionId)}/annotations/${z.uuid().parse(annotationId)}`;
  const backend: McpFeedbackBackend = {
    async list() {
      return z.object({ sessions: z.array(FeedbackExportSchema) }).parse(await request('/sessions'))
        .sessions;
    },
    async get(sessionId) {
      return FeedbackExportSchema.parse(await request(sessionPath(sessionId)));
    },
    async createAnnotation(sessionId, input) {
      return FeedbackExportSchema.parse(
        await request(`${sessionPath(sessionId)}/annotations`, 'POST', input),
      );
    },
    async updateAnnotation(sessionId, annotationId, patch) {
      return FeedbackExportSchema.parse(
        await request(annotationPath(sessionId, annotationId), 'PATCH', patch),
      );
    },
    async deleteAnnotation(sessionId, annotationId) {
      return FeedbackExportSchema.parse(
        await request(annotationPath(sessionId, annotationId), 'DELETE'),
      );
    },
  };
  return {
    backend,
    async project() {
      const { project } = await lease();
      return { ...project.config, root: project.root };
    },
    close(): Promise<void> {
      closed = true;
      return leases?.close() ?? Promise.resolve();
    },
  };
}
