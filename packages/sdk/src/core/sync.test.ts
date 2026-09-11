import { createFeedbackDocument } from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createSyncClient, normalizeConnection } from './sync';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('allows only explicit loopback endpoints and header-safe pairing tokens', () => {
  expect(
    normalizeConnection({ endpoint: 'http://127.0.0.1:4748/', token: ' test-token ' }),
  ).toEqual({ endpoint: 'http://127.0.0.1:4748', token: 'test-token' });
  for (const endpoint of [
    'https://example.com',
    'http://user@localhost',
    'http://localhost/path',
    'http://localhost/?token=x',
  ]) {
    expect(() => normalizeConnection({ endpoint, token: 'test-token' })).toThrow();
  }
  expect(() =>
    normalizeConnection({ endpoint: 'http://localhost', token: 'bad\nheader' }),
  ).toThrow();
});

it.each(['headers', 'heartbeat'] as const)(
  'reconnects a stalled SSE %s path and stops its timers on teardown',
  async (stall) => {
    vi.useFakeTimers();
    const document = createFeedbackDocument(location.href);
    const states: string[] = [];
    let subscriptions = 0;
    const fetcher = vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      if (init?.method === 'POST')
        return Promise.resolve({
          ok: true,
          json: async () => ({ document, acknowledged: [] }),
        } as Response);
      subscriptions++;
      const signal = init?.signal;
      if (stall === 'headers')
        return new Promise((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        });
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => controller.error(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        },
      });
      return Promise.resolve(
        new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
      );
    });
    const client = createSyncClient({
      connection: { endpoint: 'http://127.0.0.1:4748', token: 'test-token' },
      sessionId: document.id,
      read: async () => ({
        document,
        operations: [],
        draft: { text: '', editingId: null, targets: [] },
        authority: null,
      }),
      apply: async () => {},
      onState: (state) => states.push(state),
      onSync: () => {},
    });
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(subscriptions).toBe(1);
      await vi.advanceTimersByTimeAsync(stall === 'headers' ? 10001 : 35001);
      expect(states).toContain('error');
      await vi.advanceTimersByTimeAsync(2500);
      expect(subscriptions).toBe(2);
      client.stop();
      await vi.advanceTimersByTimeAsync(0);
      const count = fetcher.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60000);
      expect(fetcher).toHaveBeenCalledTimes(count);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      client.stop();
    }
  },
);
