import { afterEach, expect, it, vi } from 'vite-plus/test';
import { developmentBridge } from './development';
import { normalizeConnection } from './sync';

afterEach(() => vi.restoreAllMocks());

it('resolves project-scoped same-origin credentials and rejects a different project or endpoint', async () => {
  const controller = new AbortController();
  const token = 'a'.repeat(64);
  const endpoint = `${location.origin}/__ainotation/api`;
  const fetch = vi
    .spyOn(window, 'fetch')
    .mockResolvedValue(
      new Response(JSON.stringify({ projectId: 'project', endpoint, token }), { status: 200 }),
    );
  const bridge = developmentBridge(
    { bridge: '/__ainotation', projectName: 'Test' },
    'project',
    controller.signal,
  );
  const credentials = await bridge.resolve();
  expect(normalizeConnection(credentials)).toEqual({ endpoint, token, transport: 'same-origin' });
  expect(fetch.mock.calls[0]![1]).toMatchObject({
    method: 'POST',
    headers: { 'X-Ainotation-Client': '1' },
    credentials: 'omit',
    redirect: 'error',
  });
  fetch.mockResolvedValue(new Response(JSON.stringify({ projectId: 'another', endpoint, token })));
  await expect(bridge.resolve()).rejects.toThrow('different project');
  fetch.mockResolvedValue(
    new Response(
      JSON.stringify({ projectId: 'project', endpoint: 'https://example.com/api', token }),
    ),
  );
  await expect(bridge.resolve()).rejects.toThrow('different project');
});

it('does not allow development transport to bypass same-origin or URL restrictions', () => {
  const controller = new AbortController();
  for (const bridge of [
    'https://example.com/bridge',
    `${location.origin}/bridge?token=test`,
    `${location.origin}/bridge#fragment`,
  ]) {
    expect(() =>
      developmentBridge({ bridge, projectName: 'Test' }, 'project', controller.signal),
    ).toThrow('same-origin');
  }
  expect(() =>
    normalizeConnection({
      endpoint: 'https://example.com/api',
      token: 'a',
      transport: 'same-origin',
    }),
  ).toThrow('same-origin');
});

it('aborts bootstrap for a stopped sync without aborting the SDK lifetime', async () => {
  const lifetime = new AbortController();
  const sync = new AbortController();
  let requestSignal: AbortSignal | null | undefined;
  vi.spyOn(window, 'fetch').mockImplementation((_url, options) => {
    requestSignal = options?.signal;
    return new Promise<never>((_resolve, reject) =>
      requestSignal?.addEventListener(
        'abort',
        () => reject(new DOMException('Aborted', 'AbortError')),
        { once: true },
      ),
    );
  });
  const bridge = developmentBridge(
    { bridge: '/__ainotation', projectName: 'Test' },
    'project',
    lifetime.signal,
  );
  const pending = bridge.resolve(sync.signal);
  const assertion = expect(pending).rejects.toThrow('Aborted');
  sync.abort();
  await assertion;
  expect(requestSignal?.aborted).toBe(true);
  expect(lifetime.signal.aborted).toBe(false);
});
