import type { InspectorShell } from './ui/index.js';

export type { FeedbackDocument } from '@ainotation/schema';

export interface AinotationOptions {
  container?: HTMLElement;
  onDestroy?: () => void;
}

export interface Ainotation {
  mount(): Promise<void>;
  destroy(): void;
  readonly mounted: boolean;
}

export function createAinotation(options: AinotationOptions = {}): Ainotation {
  let shell: InspectorShell | undefined;
  let pending: Promise<void> | undefined;
  let generation = 0;

  function destroy(): void {
    generation++;
    pending = undefined;
    if (!shell) return;
    shell.removeEventListener('ainotation-close', destroy);
    shell.remove();
    shell = undefined;
    options.onDestroy?.();
  }

  return {
    mount(): Promise<void> {
      if (shell) return Promise.resolve();
      if (pending) return pending;
      if (typeof document === 'undefined' || !document.body) {
        return Promise.reject(new Error('Mount Ainotation after the browser document is ready.'));
      }
      const token = generation;
      pending = import('./ui/index.js')
        .then(({ registerInspectorShell }) => {
          if (token !== generation) return;
          const container = options.container ?? document.body;
          registerInspectorShell();
          shell = document.createElement('ainotation-inspector-shell');
          Object.assign(shell.style, {
            position: 'fixed',
            right: '16px',
            bottom: '16px',
            zIndex: '2147483647',
          });
          shell.addEventListener('ainotation-close', destroy);
          container.append(shell);
        })
        .finally(() => {
          if (token === generation) pending = undefined;
        });
      return pending;
    },
    destroy,
    get mounted(): boolean {
      return shell !== undefined;
    },
  };
}
