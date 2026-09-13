import { createAinotation, type Ainotation } from '@ainotation/sdk';

const INSTANCE = Symbol.for('ainotation.vite.instance');
type State = { instance: Ainotation; dispose: () => void };
type Host = Window & { [INSTANCE]?: State };

export function mountDevelopmentInspector(options: {
  projectId: string;
  projectName: string;
  bridge: string;
}): () => void {
  const host = window as Host;
  host[INSTANCE]?.dispose();
  const events = new AbortController();
  const instance = createAinotation({
    projectId: options.projectId,
    development: { bridge: options.bridge, projectName: options.projectName },
  });
  const state: State = {
    instance,
    dispose() {
      events.abort();
      instance.destroy();
      if (host[INSTANCE] === state) delete host[INSTANCE];
    },
  };
  host[INSTANCE] = state;
  const mount = () => {
    void instance.mount().catch(() => {
      console.warn('Ainotation could not mount. Check the development server.');
    });
  };
  window.addEventListener('pagehide', () => instance.destroy(), { signal: events.signal });
  window.addEventListener(
    'pageshow',
    (event) => {
      if (event.persisted) mount();
    },
    { signal: events.signal },
  );
  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', mount, { once: true, signal: events.signal });
  else mount();
  return () => state.dispose();
}
