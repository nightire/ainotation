import { z } from 'zod';
import { GrantRequestSchema, type GrantRequest } from './project-service';
import { ProjectError } from './project';
import { StoreError } from './store';
import { serviceRequest } from './service-client';
import type { ServiceConnection } from './shared-service';

const metadata = {
  projectId: z.uuid(),
  grantId: z.uuid(),
  expiresAt: z.number().finite().positive(),
};
const agent = z.object({ ...metadata, kind: z.literal('agent') }).strict();
const browser = z.object({ ...metadata, kind: z.literal('browser'), origin: z.string() }).strict();
const token = z.string().regex(/^[a-f0-9]{64}$/);
const IssuedSchema = z.discriminatedUnion('kind', [
  agent.extend({ token }),
  browser.extend({ token }),
]);
const RenewedSchema = z.discriminatedUnion('kind', [agent, browser]);
export interface LeaseConnection {
  service: ServiceConnection;
  grant: z.infer<typeof IssuedSchema>;
}
export interface LeaseClient {
  readonly signal: AbortSignal;
  get(): Promise<LeaseConnection>;
  invalidate(connection: LeaseConnection, error: unknown): void;
  close(): Promise<void>;
}

/** Owns acquisition, renewal and revocation for exactly one immutable grant scope. */
export function createLeaseClient(options: {
  request: GrantRequest;
  getService: (signal: AbortSignal) => Promise<ServiceConnection>;
  prepare: (service: ServiceConnection, signal: AbortSignal) => Promise<unknown>;
  revokedMessage: string;
}): LeaseClient {
  const request = GrantRequestSchema.parse(options.request);
  const controller = new AbortController();
  const owned = new Set<LeaseConnection>();
  const revocations = new Map<LeaseConnection, Promise<void>>();
  let current: LeaseConnection | undefined;
  let opening: Promise<LeaseConnection> | undefined;
  let renewal: Promise<void> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closing: Promise<void> | undefined;
  let blockedInstance: string | undefined;
  const active = () => {
    if (controller.signal.aborted) throw new ProjectError('Project connection is closed.');
  };
  const matches = (grant: z.infer<typeof RenewedSchema>) =>
    grant.kind === request.kind &&
    grant.projectId === request.projectId &&
    (grant.kind !== 'browser' || (request.kind === 'browser' && grant.origin === request.origin));

  function revoke(connection: LeaseConnection): Promise<void> {
    const pending = revocations.get(connection);
    if (pending) return pending;
    const work = serviceRequest(connection.service, `/control/grants/${connection.grant.grantId}`, {
      method: 'DELETE',
      timeoutMs: 2000,
    })
      .catch(() => {
        /* Unreachable grants expire on the service. */
      })
      .then(() => {
        owned.delete(connection);
        revocations.delete(connection);
      });
    revocations.set(connection, work);
    return work;
  }
  function invalidate(connection: LeaseConnection, error: unknown, renewing = false) {
    if (current !== connection) return;
    const revoked =
      error instanceof StoreError &&
      ([401, 403].includes(error.status) || (renewing && error.status === 404));
    if (revoked && Date.now() < connection.grant.expiresAt)
      blockedInstance = connection.service.instanceId;
    current = undefined;
    clearTimeout(timer);
    void revoke(connection);
  }
  function schedule(connection: LeaseConnection) {
    if (current !== connection || controller.signal.aborted) return;
    clearTimeout(timer);
    timer = setTimeout(
      () => {
        renewal = (async () => {
          try {
            const grant = RenewedSchema.parse(
              await serviceRequest(
                connection.service,
                `/control/grants/${connection.grant.grantId}/renew`,
                { method: 'POST', signal: controller.signal },
              ),
            );
            if (!matches(grant) || grant.grantId !== connection.grant.grantId)
              throw new ProjectError('Shared service returned a different lease identity.');
            connection.grant.expiresAt = grant.expiresAt;
            schedule(connection);
          } catch (error) {
            if (!controller.signal.aborted) invalidate(connection, error, true);
          }
        })();
      },
      Math.max(10, Math.min(60000, (connection.grant.expiresAt - Date.now()) / 3)),
    );
    timer.unref();
  }
  async function acquire(): Promise<LeaseConnection> {
    const service = await options.getService(controller.signal);
    active();
    if (service.instanceId === blockedInstance) throw new ProjectError(options.revokedMessage);
    blockedInstance = undefined;
    await options.prepare(service, controller.signal);
    active();
    const grant = IssuedSchema.parse(
      await serviceRequest(service, '/control/grants', {
        method: 'POST',
        body: request,
        signal: controller.signal,
      }),
    );
    const connection = { service, grant };
    owned.add(connection);
    if (!matches(grant) || controller.signal.aborted) {
      await revoke(connection);
      active();
      throw new ProjectError('Shared service returned a different project authorization.');
    }
    current = connection;
    schedule(connection);
    return connection;
  }
  return {
    signal: controller.signal,
    async get() {
      active();
      if (current && current.grant.expiresAt > Date.now()) return current;
      if (current) invalidate(current, new Error('Lease expired'));
      opening ??= acquire().finally(() => {
        opening = undefined;
      });
      const connection = await opening;
      active();
      return connection;
    },
    invalidate,
    close() {
      closing ??= (async () => {
        controller.abort();
        clearTimeout(timer);
        await Promise.allSettled([opening, renewal]);
        await Promise.all([...owned].map(revoke));
        current = undefined;
      })();
      return closing;
    },
  };
}
