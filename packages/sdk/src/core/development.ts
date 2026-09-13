import type { McpConnection } from './sync';

export interface DevelopmentConnection {
  bridge: string;
  projectName: string;
}

export function developmentBridge(
  options: DevelopmentConnection,
  projectId: string,
  signal: AbortSignal,
) {
  const url = new URL(options.bridge, location.href);
  if (
    url.origin !== location.origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['http:', 'https:'].includes(url.protocol)
  )
    throw new Error('Development bridge must be a same-origin HTTP(S) URL.');
  const endpoint = `${url.href.replace(/\/$/, '')}/api`;
  return {
    authority: endpoint,
    async resolve(syncSignal?: AbortSignal): Promise<McpConnection> {
      const response = await fetch(`${url.href.replace(/\/$/, '')}/connect`, {
        method: 'POST',
        headers: { 'X-Ainotation-Client': '1' },
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.any([
          signal,
          ...(syncSignal ? [syncSignal] : []),
          AbortSignal.timeout(15000),
        ]),
      });
      if (!response.ok) throw new Error('Development bridge is unavailable');
      const data = (await response.json()) as Record<string, unknown>;
      if (
        data.projectId !== projectId ||
        data.endpoint !== endpoint ||
        typeof data.token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(data.token)
      )
        throw new Error('Development bridge returned a different project or invalid credentials');
      return { endpoint, token: data.token, transport: 'same-origin' };
    },
  };
}
