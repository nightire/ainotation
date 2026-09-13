import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createLeaseClient, type LeaseClient } from './lease-client';
import { StoreError } from './store';

const clients: LeaseClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});
const service = {
  version: 1 as const,
  instanceId: crypto.randomUUID(),
  pid: 1,
  url: 'http://127.0.0.1:1',
  token: 'a'.repeat(64),
};
function setup() {
  const grant = {
    kind: 'agent' as const,
    projectId: crypto.randomUUID(),
    grantId: crypto.randomUUID(),
    token: 'b'.repeat(64),
    expiresAt: Date.now() + 60000,
  };
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (_input, options) =>
      options?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(grant)),
    );
  const client = createLeaseClient({
    request: { kind: 'agent', projectId: grant.projectId },
    getService: async () => service,
    prepare: async () => {},
    revokedMessage: 'Authorization revoked',
  });
  clients.push(client);
  return { client, grant, fetcher };
}

it('coalesces parallel acquisition and deduplicates revocation during close', async () => {
  const { client, fetcher } = setup();
  const leases = await Promise.all([client.get(), client.get(), client.get()]);
  expect(leases[0]).toBe(leases[1]);
  expect(leases[1]).toBe(leases[2]);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
  client.invalidate(leases[0]!, new Error('Disconnected'));
  await Promise.all([client.close(), client.close()]);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
});

it('revokes an issued grant that arrives after the connection has already closed', async () => {
  const { client, grant, fetcher } = setup();
  let deliver!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        deliver = resolve;
      }),
  );
  const opening = client.get();
  const rejected = expect(opening).rejects.toThrow('closed');
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  const closing = client.close();
  deliver(new Response(JSON.stringify(grant)));
  await rejected;
  await closing;
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'DELETE')).toHaveLength(1);
  expect(client.signal.aborted).toBe(true);
});

it('does not silently recreate revoked authorization on the same service', async () => {
  const { client, fetcher } = setup();
  const lease = await client.get();
  client.invalidate(lease, new StoreError(401, 'Revoked'));
  await expect(client.get()).rejects.toThrow('Authorization revoked');
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});

it('does not let a late renewal cancel the replacement lease timer', async () => {
  vi.useFakeTimers();
  const { client, grant, fetcher } = setup();
  grant.expiresAt = Date.now() + 90;
  const replacement = { ...grant, grantId: crypto.randomUUID() };
  let deliver!: (response: Response) => void;
  let issued = 0;
  fetcher.mockImplementation(async (url, options) => {
    if (typeof url !== 'string') throw new Error('Expected a string service URL');
    if (options?.method === 'DELETE') return new Response(null, { status: 204 });
    if (url.endsWith(`/grants/${grant.grantId}/renew`))
      return new Promise((resolve) => {
        deliver = resolve;
      });
    if (url.endsWith('/renew'))
      return new Response(
        JSON.stringify({
          kind: 'agent',
          projectId: grant.projectId,
          grantId: replacement.grantId,
          expiresAt: Date.now() + 90,
        }),
      );
    if (issued++ === 0) return new Response(JSON.stringify(grant));
    replacement.expiresAt = Date.now() + 90;
    return new Response(JSON.stringify(replacement));
  });
  await client.get();
  await vi.advanceTimersByTimeAsync(30);
  expect(deliver).toBeTypeOf('function');
  await vi.advanceTimersByTimeAsync(61);
  expect((await client.get()).grant.grantId).toBe(replacement.grantId);
  deliver(
    new Response(
      JSON.stringify({
        kind: 'agent',
        projectId: grant.projectId,
        grantId: grant.grantId,
        expiresAt: Date.now() + 90,
      }),
    ),
  );
  await vi.advanceTimersByTimeAsync(31);
  expect(
    fetcher.mock.calls.some(
      ([url]) => typeof url === 'string' && url.endsWith(`/grants/${replacement.grantId}/renew`),
    ),
  ).toBe(true);
});
