import { SyncResponseSchema } from '@ainotation/schema';
import type { DraftRecord } from './storage';
import type { SyncResponse } from '@ainotation/schema';

export interface McpConnection {
  endpoint: string;
  token: string;
}

export function normalizeConnection(connection: McpConnection): McpConnection {
  const url = new URL(connection.endpoint);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error('MCP endpoint must be a loopback HTTP(S) origin.');
  }
  if (
    !connection.token.trim() ||
    /\s/.test(connection.token.trim()) ||
    connection.token.length > 512
  )
    throw new Error('Enter a valid pairing token.');
  return { endpoint: url.origin, token: connection.token.trim() };
}

export function createSyncClient(options: {
  connection: McpConnection;
  sessionId: string;
  read: () => Promise<DraftRecord>;
  apply: (response: SyncResponse) => Promise<void>;
  onState: (state: 'connecting' | 'connected' | 'error', message: string) => void;
  onSync: (syncing: boolean) => void;
}) {
  const connection = normalizeConnection(options.connection);
  const controller = new AbortController();
  const headers = { Authorization: `Bearer ${connection.token}` };
  let stopped = false;
  let wanted = false;
  let running: Promise<void> | undefined;
  let streaming: AbortController | undefined;
  const sync = (): Promise<void> => {
    wanted = true;
    if (running) return running;
    running = (async () => {
      options.onSync(true);
      try {
        while (wanted && !stopped) {
          wanted = false;
          const record = await options.read();
          if (stopped) return;
          const response = await fetch(
            `${connection.endpoint}/sessions/${options.sessionId}/sync`,
            {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/json' },
              credentials: 'omit',
              cache: 'no-store',
              body: JSON.stringify({ document: record.document, operations: record.operations }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            },
          );
          if (!response.ok)
            throw new Error(
              `MCP sync failed (${response.status}). Check pairing token, allowed origin and request size.`,
            );
          const data = SyncResponseSchema.parse(await response.json());
          if (data.document.id !== options.sessionId || data.document.url !== record.document.url)
            throw new Error('MCP returned another session.');
          if (!stopped) await options.apply(data);
        }
      } finally {
        running = undefined;
        if (!stopped) options.onSync(false);
      }
    })();
    return running;
  };
  const request = () => {
    if (!stopped)
      void sync().catch(() => {
        if (stopped) return;
        options.onState('error', 'MCP sync failed; local changes are retained for retry.');
        streaming?.abort();
      });
  };
  const delay = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        controller.signal.removeEventListener('abort', done);
        resolve();
      };
      const timer = setTimeout(done, 2500);
      controller.signal.addEventListener('abort', done, { once: true });
    });
  void (async () => {
    while (!stopped) {
      options.onState('connecting', 'Connecting to MCP server');
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const armWatchdog = (duration: number) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => streaming?.abort(), duration);
      };
      try {
        await sync();
        if (stopped) break;
        streaming = new AbortController();
        armWatchdog(10000);
        const response = await fetch(
          `${connection.endpoint}/sessions/${options.sessionId}/events`,
          {
            headers,
            credentials: 'omit',
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, streaming.signal]),
          },
        );
        if (!response.ok || !response.body) throw new Error('MCP event stream unavailable');
        reader = response.body.getReader();
        armWatchdog(35000);
        options.onState('connected', 'MCP server connected');
        const decoder = new TextDecoder();
        let buffer = '';
        while (!stopped) {
          const chunk = await reader.read();
          if (chunk.done) throw new Error('MCP disconnected');
          armWatchdog(35000);
          buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r/g, '');
          if (buffer.length > 65536) throw new Error('Invalid MCP event stream');
          let boundary;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            if (event.includes('event: changed')) request();
          }
        }
      } catch {
        if (!stopped)
          options.onState('error', 'MCP unavailable. Local feedback is retained; retrying.');
      } finally {
        clearTimeout(watchdog);
        await reader?.cancel().catch(() => {});
      }
      if (!stopped) await delay();
    }
  })();
  return {
    request,
    stop() {
      stopped = true;
      controller.abort();
    },
  };
}
