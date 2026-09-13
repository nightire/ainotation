import type { ServiceConnection } from './shared-service';
import { StoreError } from './store';

export async function serviceRequest(
  connection: ServiceConnection,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10000);
  const response = await fetch(`${connection.url}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${options.token ?? connection.token}`,
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    redirect: 'error',
    credentials: 'omit',
    cache: 'no-store',
  });
  if (!response.ok) {
    // Surface safe status messages, never the credential or arbitrary response body.
    const messages: Record<number, string> = {
      400: 'Invalid project request',
      401: 'Project connection is no longer authorized',
      403: 'Project connection does not allow this operation',
      404: 'Requested resource does not exist in this project',
      409: 'Project identity or annotation conflicts with existing data',
      413: 'Feedback exceeds the service request limit',
      503: 'Shared service is closing',
    };
    await response.body?.cancel();
    throw new StoreError(
      response.status,
      messages[response.status] ?? 'Shared service request failed',
    );
  }
  if (response.status === 204) return undefined;
  return response.json();
}
