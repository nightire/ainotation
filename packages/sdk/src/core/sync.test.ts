import { createFeedbackDocument } from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { createSyncClient, normalizeConnection } from './sync';
import { syncImages } from './image-sync';
import { canvasBlob, describeImage } from './images';
import { capturePage } from './selection';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it.each(['conflict', 'storage-error'] as const)(
  'pauses on %s without replacing local feedback or repeatedly retrying',
  async (failure) => {
    const document = createFeedbackDocument(location.href);
    const recovery = {
      document,
      acknowledged: [],
      storageEpoch: crypto.randomUUID(),
      recovery: { revision: 'a'.repeat(64) },
    };
    const fetcher = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () =>
        failure === 'conflict'
          ? Response.json(recovery)
          : Response.json({ code: 'storage-unavailable' }, { status: 500 }),
      );
    const apply = vi.fn(async () => {});
    const onRecovery = vi.fn(async () => {});
    const states = vi.fn();
    const client = createSyncClient({
      connection: { endpoint: 'http://127.0.0.1:4748', token: 'test-token' },
      sessionId: document.id,
      read: async () => ({
        document,
        operations: [],
        draft: { text: '', editingId: null, targets: [] },
        authority: null,
        storageEpoch: crypto.randomUUID(),
      }),
      apply,
      onState: states,
      onSync() {},
      onRecovery,
    });
    try {
      await client.finished;
      client.request();
      await Promise.resolve();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(apply).not.toHaveBeenCalled();
      expect(onRecovery).toHaveBeenCalledTimes(failure === 'conflict' ? 1 : 0);
      expect(states.mock.calls.at(-1)?.[0]).toBe('error');
    } finally {
      client.stop();
    }
  },
);

it('reuploads a missing server image even when it was already uploaded by this client', async () => {
  const canvas = window.document.createElement('canvas');
  canvas.width = canvas.height = 16;
  const blob = await canvasBlob(canvas);
  const image = await describeImage(blob, 'import');
  const document = createFeedbackDocument(location.href);
  document.annotations.push({
    id: crypto.randomUUID(),
    comment: 'Image',
    createdAt: document.createdAt,
    updatedAt: document.createdAt,
    page: capturePage(),
    targets: [
      {
        id: crypto.randomUUID(),
        selector: 'body',
        shadowHosts: [],
        tagName: 'body',
        text: '',
        attributes: {},
        styles: {},
        rect: { x: 0, y: 0, width: 10, height: 10 },
      },
    ],
    status: 'pending',
    replies: [],
    images: [image],
  });
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(null, { status: 204 }));
  const options = {
    document,
    local: { [image.id]: blob },
    connection: { endpoint: 'http://127.0.0.1:4748', token: 'test-token' },
    signal: new AbortController().signal,
    uploaded: new Set<string>(),
  };
  await syncImages(options);
  await syncImages(options);
  expect(fetcher).toHaveBeenCalledOnce();
  await syncImages({ ...options, missing: [image.id] });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls.every(([, init]) => init?.method === 'POST')).toBe(true);
});

it('refreshes a stale recovery choice before applying any server snapshot', async () => {
  const document = createFeedbackDocument(location.href);
  const recovery = {
    epoch: crypto.randomUUID(),
    revision: 'a'.repeat(64),
    source: 'browser' as const,
  };
  const latest = {
    document,
    acknowledged: [],
    storageEpoch: recovery.epoch,
    recovery: { revision: 'b'.repeat(64) },
  };
  const fetcher = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({ code: 'recovery-stale' }, { status: 409 }))
    .mockResolvedValueOnce(Response.json(latest));
  const apply = vi.fn(async () => {});
  const onRecovery = vi.fn(async () => {});
  const client = createSyncClient({
    connection: { endpoint: 'http://127.0.0.1:4748', token: 'test-token' },
    sessionId: document.id,
    recovery,
    read: async () => ({
      document,
      operations: [],
      draft: { text: '', editingId: null, targets: [] },
      authority: null,
    }),
    apply,
    onRecovery,
    onState() {},
    onSync() {},
  });
  try {
    await client.finished;
    expect(fetcher).toHaveBeenCalledTimes(2);
    const requests = fetcher.mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(requests[0].recovery).toEqual(recovery);
    expect(requests[1]).not.toHaveProperty('recovery');
    expect(onRecovery).toHaveBeenCalledExactlyOnceWith(latest);
    expect(apply).not.toHaveBeenCalled();
  } finally {
    client.stop();
  }
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
      expect(fetcher.mock.calls.every(([, options]) => options?.redirect === 'error')).toBe(true);
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

it('cancels pending credential resolution when synchronization stops', async () => {
  const document = createFeedbackDocument(location.href);
  let signal: AbortSignal | undefined;
  const state = vi.fn();
  const provider = vi.fn((value: AbortSignal) => {
    signal = value;
    return new Promise<never>((_resolve, reject) =>
      value.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      }),
    );
  });
  const fetcher = vi.spyOn(globalThis, 'fetch');
  const client = createSyncClient({
    connection: provider,
    sessionId: document.id,
    read: async () => ({
      document,
      operations: [],
      draft: { text: '', editingId: null, targets: [] },
      authority: null,
    }),
    apply: async () => {},
    onState: state,
    onSync() {},
  });
  try {
    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce());
    client.stop();
    expect(signal?.aborted).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(fetcher).not.toHaveBeenCalled();
    expect(state.mock.calls.map(([value]) => value)).toEqual(['connecting']);
  } finally {
    client.stop();
  }
});

it('applies feedback metadata and later deletions even while attachment bytes are unavailable', async () => {
  vi.useFakeTimers();
  const document = createFeedbackDocument(location.href);
  const now = new Date().toISOString();
  document.annotations.push({
    id: crypto.randomUUID(),
    comment: 'New feedback with a pending image',
    createdAt: now,
    updatedAt: now,
    page: {
      url: location.href,
      title: 'Sync fixture',
      viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    },
    targets: [
      {
        id: crypto.randomUUID(),
        selector: 'body',
        tagName: 'body',
        text: '',
        shadowHosts: [],
        attributes: {},
        styles: {},
        rect: { x: 0, y: 0, width: 800, height: 600 },
      },
    ],
    images: [
      {
        id: crypto.randomUUID(),
        mimeType: 'image/png',
        source: 'import',
        width: 1,
        height: 1,
        size: 4,
        sha256: '0'.repeat(64),
      },
    ],
    status: 'pending',
    replies: [],
  });
  let remote = structuredClone(document);
  const applied = vi.fn(async () => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (init?.method === 'POST') return Response.json({ document: remote, acknowledged: [] });
    if (typeof input === 'string' && input.includes('/images/'))
      return new Response(null, { status: 404 });
    return new Promise<Response>((_resolve, reject) =>
      init?.signal?.addEventListener('abort', () => reject(new Error('Stopped')), { once: true }),
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
    apply: applied,
    onState() {},
    onSync() {},
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(applied).toHaveBeenCalledWith({ document: remote, acknowledged: [] }, {});
    remote = { ...remote, annotations: [] };
    await vi.advanceTimersByTimeAsync(2500);
    expect(applied).toHaveBeenLastCalledWith({ document: remote, acknowledged: [] }, {});
  } finally {
    client.stop();
    await vi.advanceTimersByTimeAsync(0);
  }
});
