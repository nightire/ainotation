import { SyncResponseSchema } from '@ainotation/schema';
import type { DraftRecord } from './storage';
import type { SyncResponse } from '@ainotation/schema';
import { syncImages } from './image-sync';
import { uiError, msg, type UiMessage } from '../i18n';

export interface McpConnection {
  endpoint: string;
  token: string;
  transport?: 'same-origin';
}

export function normalizeConnection(connection: McpConnection): McpConnection {
  const url = new URL(connection.endpoint);
  if (connection.transport === 'same-origin') {
    if (
      url.origin !== location.origin ||
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('Development MCP endpoint must be same-origin.');
  } else if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw uiError('invalidEndpoint');
  }
  if (
    !connection.token.trim() ||
    /\s/.test(connection.token.trim()) ||
    connection.token.length > 512
  )
    throw uiError('invalidToken');
  return {
    endpoint: connection.transport === 'same-origin' ? url.href.replace(/\/$/, '') : url.origin,
    token: connection.token.trim(),
    ...(connection.transport ? { transport: connection.transport } : {}),
  };
}

export function createSyncClient(options: {
  connection: McpConnection | ((signal: AbortSignal) => Promise<McpConnection>);
  sessionId: string;
  read: () => Promise<DraftRecord>;
  apply: (response: SyncResponse, images: Record<string, Blob>) => Promise<void>;
  onState: (state: 'connecting' | 'connected' | 'error', message: UiMessage) => void;
  onSync: (syncing: boolean) => void;
}) {
  const controller = new AbortController();
  const configured = options.connection;
  const resolveConnection =
    typeof configured === 'function'
      ? async () => normalizeConnection(await configured(controller.signal))
      : (() => {
          const connection = normalizeConnection(configured);
          return async () => connection;
        })();
  let stopped = false;
  const uploaded = new Set<string>();
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
          const connection = await resolveConnection();
          if (stopped) return;
          const response = await fetch(
            `${connection.endpoint}/sessions/${options.sessionId}/sync`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${connection.token}`,
                'Content-Type': 'application/json',
              },
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              body: JSON.stringify({ document: record.document, operations: record.operations }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]),
            },
          );
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error(
              `MCP sync failed (${response.status}). Check pairing token, allowed origin and request size.`,
            );
          }
          const data = SyncResponseSchema.parse(await response.json());
          if (data.document.id !== options.sessionId || data.document.url !== record.document.url)
            throw new Error('MCP returned another session.');
          // Text/deletions must remain usable when metadata arrives before its
          // image bytes, or an attachment transfer fails and needs a retry.
          if (!stopped) await options.apply(data, {});
          if (stopped) return;
          const images = await syncImages({
            document: data.document,
            local: record.images ?? {},
            connection,
            signal: controller.signal,
            uploaded,
          });
          if (!stopped && Object.keys(images).length) await options.apply(data, images);
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
        options.onState('error', msg('syncFailed'));
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
      options.onState('connecting', msg('syncConnecting'));
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let watchdog: ReturnType<typeof setTimeout> | undefined;
      const armWatchdog = (duration: number) => {
        clearTimeout(watchdog);
        watchdog = setTimeout(() => streaming?.abort(), duration);
      };
      try {
        await sync();
        if (stopped) break;
        const connection = await resolveConnection();
        if (stopped) break;
        streaming = new AbortController();
        armWatchdog(10000);
        const response = await fetch(
          `${connection.endpoint}/sessions/${options.sessionId}/events`,
          {
            headers: { Authorization: `Bearer ${connection.token}` },
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.any([controller.signal, streaming.signal]),
          },
        );
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new Error('MCP event stream unavailable');
        }
        reader = response.body.getReader();
        armWatchdog(35000);
        options.onState('connected', msg('syncConnected'));
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
        uploaded.clear();
        if (!stopped) options.onState('error', msg('syncUnavailable'));
      } finally {
        clearTimeout(watchdog);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
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
