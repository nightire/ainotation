import type { InspectorShell } from './ui/index.js';
import type { createRuntime } from './runtime';
import type { FeedbackDocument } from '@ainotation/schema';
import type { McpConnection } from './core/sync';
import type { DevelopmentConnection } from './core/development';

export type { FeedbackDocument, FeedbackExport } from '@ainotation/schema';

export interface AinotationOptions {
  container?: HTMLElement;
  onDestroy?: () => void;
  projectId?: string;
  /** false disables MCP, including saved credentials, sync and connection controls. */
  mcp?: McpConnection | false;
  development?: DevelopmentConnection;
}

export interface Ainotation {
  mount(): Promise<void>;
  destroy(): void;
  readonly mounted: boolean;
  getDocument(): FeedbackDocument | null;
  copyFeedback(): Promise<string>;
}

export function createAinotation(options: AinotationOptions = {}): Ainotation {
  let shell: InspectorShell | undefined;
  let pending: Promise<void> | undefined;
  let generation = 0;
  let runtime: Awaited<ReturnType<typeof createRuntime>> | undefined;
  let controller: AbortController | undefined;

  function destroy(): void {
    generation++;
    pending = undefined;
    controller?.abort();
    runtime?.destroy();
    runtime = undefined;
    if (!shell) return;
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
      controller = new AbortController();
      const signal = controller.signal;
      pending = import('./ui/index.js')
        .then(async ({ registerInspectorShell }) => {
          if (token !== generation) return;
          const container = options.container ?? document.body;
          registerInspectorShell();
          shell = document.createElement('ainotation-inspector-shell');
          shell.dataset.ainotationUi = 'true';
          container.append(shell);
          const { createRuntime } = await import('./runtime');
          if (token !== generation) return;
          const created = await createRuntime(shell, options, signal);
          if (token !== generation) created.destroy();
          else runtime = created;
        })
        .catch((error: unknown) => {
          if (token !== generation) return;
          destroy();
          throw error;
        })
        .finally(() => {
          if (token === generation) pending = undefined;
        });
      return pending;
    },
    destroy,
    getDocument() {
      return runtime?.getDocument() ?? null;
    },
    copyFeedback() {
      return runtime ? runtime.copy() : Promise.reject(new Error('Mount Ainotation first.'));
    },
    get mounted(): boolean {
      return shell !== undefined;
    },
  };
}
