import { AnnotationSchema } from '@ainotation/schema';
import type {
  Annotation,
  FeedbackDocument,
  FeedbackOperation,
  MarkerAnchor,
  TargetSnapshot,
  PageSnapshot,
} from '@ainotation/schema';
import type { InspectorShell } from './ui';
import { createSelection, capturePage } from './core/selection';
import { createDraftStore, type DraftRecord } from './core/storage';
import { createSyncClient, normalizeConnection, type McpConnection } from './core/sync';
import { emptyViewState, type InspectorAction } from './core/types';
import { createMarkerLayer } from './ui/markers';
import { bindPreferences } from './runtime-preferences';
import { copyProjectFeedback, createFeedbackDownloads } from './core/handoff';

export async function createRuntime(
  shell: InspectorShell,
  options: { projectId?: string; mcp?: McpConnection },
  signal: AbortSignal,
) {
  const view = emptyViewState();
  let disposed = false;
  let record: DraftRecord | null = null;
  let pageUrl = location.href;
  const project = options.projectId || location.origin;
  const keyFor = (url: string) => JSON.stringify([project, url]);
  let pageKey = keyFor(pageUrl);
  let pageGeneration = 0;
  let syncGeneration = 0;
  let saving = false;
  let editorVersion = 0;
  let selectionPage: PageSnapshot | null = null;
  let markerLayer: ReturnType<typeof createMarkerLayer> | undefined;
  let pendingPicking: boolean | null = null;
  let storageReady = false;
  let navigation: ReturnType<typeof setInterval> | undefined;
  let connection: McpConnection | null = null;
  let sync: ReturnType<typeof createSyncClient> | undefined;
  const credentialsKey = `ainotation:mcp:${project}`;
  const render = () => {
    if (!disposed && !signal.aborted) {
      shell.view = {
        ...view,
        selected: [...view.selected],
        availability: { ...view.availability },
      };
      markerLayer?.update(shell.view, shell.expanded && view.storage !== 'loading');
    }
  };
  const message = (text: string) => {
    view.message = text;
    render();
  };
  const report = (error: unknown) =>
    message(
      error instanceof Error ? error.message : 'The operation failed. Feedback was not cleared.',
    );
  render();
  const preferences = bindPreferences(shell, project, view, signal, render, message);

  const store = await createDraftStore({
    onUnavailable() {
      view.storage = 'unavailable';
      message('Local storage unavailable. Export feedback before reloading.');
    },
    onExternalChange() {
      const token = pageGeneration;
      if (storageReady && !disposed)
        void store
          .read(pageKey, pageUrl)
          .then((next) => {
            if (token === pageGeneration && !disposed) accept(next);
          })
          .catch(report);
    },
  });
  if (signal.aborted) {
    await store.close();
    throw new DOMException('Mount canceled', 'AbortError');
  }
  storageReady = true;

  function updateAvailability() {
    view.availability = Object.fromEntries(
      [
        ...view.selected,
        ...(record?.document.annotations.flatMap((annotation) => annotation.targets) || []),
      ].map((target) => [target.id, selection.availability(target)]),
    );
  }
  const selection = createSelection({
    visible: shell.expanded,
    onChange() {
      if (disposed) return;
      if (reconcilePage()) return;
      if (!view.editorOpen) view.selected = selection.getTargets();
      updateAvailability();
      render();
    },
    onPickingChange(picking) {
      view.picking = picking;
      render();
    },
    onPassthroughChange(active) {
      view.passthrough = active;
      render();
    },
    onSelect(anchor, targets) {
      if (disposed || reconcilePage() || view.storage === 'loading') return;
      editorVersion++;
      if (view.editingId) view.draft = '';
      view.editingId = null;
      view.selected = targets;
      selectionPage = capturePage();
      view.marker = anchor;
      view.editorOpen = true;
      view.message = '';
      render();
      void saveDraft().catch(report);
    },
    onBatchChange(active) {
      if (disposed) return;
      if (!active) {
        if (!selection.getTargets().length && record && view.storage !== 'loading')
          void saveDraft().catch(report);
        return;
      }
      editorVersion++;
      if (view.editingId) view.draft = '';
      view.editingId = null;
      view.editorOpen = false;
      view.marker = null;
      selectionPage = null;
      render();
    },
    onCancel() {
      void handle({ type: 'cancel-edit' }).catch(report);
    },
  });
  markerLayer = createMarkerLayer({
    onAction: (action) => {
      void handle(action).catch(report);
    },
    getRect: (target) => selection.getRect(target),
  });

  function fallbackAnchor(targets: TargetSnapshot[]): MarkerAnchor | null {
    const last = targets.at(-1);
    if (!last) return null;
    const rect = selection.getRect(last) ?? last.rect;
    return {
      x: rect.x + rect.width + scrollX,
      y: rect.y + rect.height + scrollY,
      space: 'document',
      targetId: last.id,
      ratioX: 1,
      ratioY: 1,
    };
  }

  function resetEditor() {
    editorVersion++;
    selectionPage = null;
    view.selected = [];
    view.draft = '';
    view.editingId = null;
    view.editorOpen = false;
    view.marker = null;
    selection.clear();
    render();
  }

  function accept(next: DraftRecord) {
    if (disposed) return;
    if (reconcilePage() || next.document.url !== pageUrl) return;
    record = next;
    view.document = next.document;
    view.storage = store.available ? 'ready' : 'unavailable';
    if (!view.editorOpen && !view.draft && next.draft.text && !next.draft.editorOpen) {
      view.draft = next.draft.text;
      view.message =
        'An edited annotation was deleted remotely. Its text is kept for a new selection.';
    }
    if (
      view.editingId &&
      !next.document.annotations.some((annotation) => annotation.id === view.editingId)
    ) {
      view.editingId = null;
      view.editorOpen = false;
      view.marker = null;
      selection.clear();
      view.message = 'The annotation was deleted. Unsaved text is kept for a new selection.';
    }
    updateAvailability();
    render();
  }
  function snapshotDraft(): DraftRecord['draft'] {
    return {
      text: view.draft,
      editingId: view.editingId,
      targets: view.editorOpen ? structuredClone(view.selected) : selection.getTargets(),
      ...(view.marker ? { marker: view.marker } : {}),
      ...(selectionPage ? { page: selectionPage } : {}),
      editorOpen: view.editorOpen,
    };
  }
  async function saveDraft() {
    const token = pageGeneration;
    const draft = snapshotDraft();
    const next = await store.update(pageKey, pageUrl, (current) => ({ ...current, draft }));
    if (token === pageGeneration) accept(next);
  }
  async function mutate(operation: FeedbackOperation, submittedDraft?: DraftRecord['draft']) {
    const token = pageGeneration;
    const next = await store.mutate(pageKey, pageUrl, operation, submittedDraft);
    if (token === pageGeneration && !disposed) {
      accept(next);
      sync?.request();
    }
  }
  async function startSync() {
    sync?.stop();
    sync = undefined;
    const token = ++syncGeneration;
    if (!record || !connection || disposed) return;
    const key = pageKey;
    const url = pageUrl;
    const currentConnection = connection;
    view.connection = 'connecting';
    render();
    const bound = await store.bindAuthority(key, url, currentConnection.endpoint);
    if (token !== syncGeneration || disposed) return;
    accept(bound);
    if (token !== syncGeneration || disposed) return;
    sync = createSyncClient({
      connection: currentConnection,
      sessionId: bound.document.id,
      read: () => store.read(key, url),
      async apply(response) {
        if (token !== syncGeneration || disposed) return;
        const next = await store.applySync(key, url, response);
        if (token === syncGeneration && !disposed) accept(next);
      },
      onState(state, text) {
        if (token === syncGeneration && !disposed) {
          view.connection = state;
          message(text);
        }
      },
      onSync(syncing) {
        if (token === syncGeneration && !disposed) {
          view.syncing = syncing;
          render();
        }
      },
    });
  }
  async function loadPage() {
    sync?.stop();
    sync = undefined;
    syncGeneration++;
    const token = ++pageGeneration;
    view.storage = 'loading';
    render();
    const next = await store.load(pageKey, pageUrl);
    if (token !== pageGeneration || disposed || signal.aborted) return;
    record = next;
    view.draft = next.draft.text;
    view.editingId =
      next.draft.editingId &&
      next.document.annotations.some((annotation) => annotation.id === next.draft.editingId)
        ? next.draft.editingId
        : null;
    selection.setTargets(next.draft.targets);
    view.marker = next.draft.marker ?? fallbackAnchor(next.draft.targets);
    view.editorOpen = next.draft.editorOpen ?? next.draft.targets.length > 0;
    view.selected = structuredClone(next.draft.targets);
    selectionPage = next.draft.page ?? (view.editorOpen ? capturePage() : null);
    selection.setVisible(shell.expanded);
    accept(next);
    selection.setPicking(pendingPicking ?? shell.expanded);
    pendingPicking = null;
    await startSync();
  }
  function disconnect() {
    sync?.stop();
    sync = undefined;
    connection = null;
    syncGeneration++;
    try {
      sessionStorage.removeItem(credentialsKey);
    } catch {
      /* Explicit disconnect still works without session storage. */
    }
    view.connection = 'offline';
    view.syncing = false;
    message('Local only');
  }
  async function connect(value: McpConnection) {
    connection = normalizeConnection(value);
    view.endpoint = connection.endpoint;
    try {
      sessionStorage.setItem(credentialsKey, JSON.stringify(connection));
    } catch {
      /* Keep credentials in memory only. */
    }
    await startSync();
  }
  const downloads = createFeedbackDownloads();
  async function copy() {
    if (reconcilePage()) throw new Error('Feedback for this page is still loading.');
    if (!record) throw new Error('Feedback is still loading.');
    const output = await copyProjectFeedback(
      store.readProjectDocuments(project),
      record.document,
      view.outputDetail,
      () => !disposed && !signal.aborted,
    );
    message('Feedback copied');
    return output;
  }
  async function handle(action: InspectorAction) {
    if (disposed || signal.aborted) return;
    if (action.type === 'set-theme' || action.type === 'set-output-detail') {
      await preferences.update(action);
      return;
    }
    if (action.type === 'set-picking') {
      pendingPicking = view.storage === 'loading' ? action.value : null;
      selection.setVisible(action.value && view.storage !== 'loading');
      selection.setPicking(action.value && view.storage !== 'loading');
      render();
      return;
    }
    if (reconcilePage() || view.storage === 'loading') {
      message('Loading feedback for this page');
      return;
    }
    if (action.type === 'connect') {
      await connect(action);
      return;
    }
    if (action.type === 'disconnect') {
      disconnect();
      return;
    }
    if (action.type === 'draft') {
      editorVersion++;
      view.draft = action.value.slice(0, 10000);
      render();
      await saveDraft();
      return;
    }
    if (!record) throw new Error('Feedback is still loading.');
    if (action.type === 'copy') {
      await copy();
      return;
    }
    if (action.type === 'export') {
      downloads.exportJson(record.document);
      message('Feedback exported');
      return;
    }
    if (action.type === 'cancel-edit') {
      resetEditor();
      await saveDraft();
      return;
    }
    if (action.type === 'clear-all') {
      if (saving) return;
      saving = true;
      view.saving = true;
      const page = pageGeneration;
      const version = editorVersion;
      const ids = record.document.annotations.map((annotation) => annotation.id);
      render();
      try {
        const next = await store.clearAnnotations(pageKey, pageUrl, ids);
        if (page === pageGeneration && !disposed) {
          if (version === editorVersion) resetEditor();
          accept(next);
          sync?.request();
          message('All annotations on this page cleared');
        }
      } finally {
        saving = false;
        view.saving = false;
        render();
      }
      return;
    }
    if (action.type === 'save') {
      if (saving) return;
      saving = true;
      view.saving = true;
      render();
      const submittedDraft = snapshotDraft();
      const { text: draft, editingId } = submittedDraft;
      const version = editorVersion;
      const page = pageGeneration;
      try {
        const existing = record.document.annotations.find(
          (annotation) => annotation.id === editingId,
        );
        if (editingId && !existing) {
          view.editingId = null;
          await saveDraft();
          message(
            'The original feedback was deleted. Your draft is kept as a new annotation draft.',
          );
          return;
        }
        const now = new Date().toISOString();
        const annotation: Annotation = AnnotationSchema.parse({
          id: existing?.id || crypto.randomUUID(),
          comment: draft,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          page: existing?.page ?? selectionPage ?? capturePage(),
          targets: existing?.targets ?? structuredClone(view.selected),
          ...(existing
            ? existing.marker
              ? { marker: existing.marker }
              : {}
            : view.marker
              ? { marker: view.marker }
              : {}),
          status: existing?.status || 'pending',
          replies: existing?.replies || [],
        });
        await mutate({ id: crypto.randomUUID(), kind: 'upsert', annotation }, submittedDraft);
        if (page === pageGeneration && version === editorVersion) {
          resetEditor();
          await saveDraft();
        }
        if (page === pageGeneration) message('Feedback saved');
      } finally {
        saving = false;
        view.saving = false;
        render();
      }
      return;
    }
    if (!('id' in action)) return;
    const annotation = record.document.annotations.find((item) => item.id === action.id);
    if (!annotation) throw new Error('This feedback no longer exists.');
    if (action.type === 'edit') {
      editorVersion++;
      view.message = '';
      view.editingId = annotation.id;
      view.draft = annotation.comment;
      view.marker = annotation.marker ?? fallbackAnchor(annotation.targets);
      view.editorOpen = true;
      view.selected = structuredClone(annotation.targets);
      selectionPage = annotation.page;
      selection.setTargets(annotation.targets);
      updateAvailability();
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'delete') {
      const editing = view.editingId === annotation.id;
      const version = editorVersion;
      await mutate({ id: crypto.randomUUID(), kind: 'delete', annotationId: annotation.id });
      if (editing && version === editorVersion) {
        resetEditor();
        await saveDraft();
      }
      return;
    }
  }
  const onAction = (event: Event) => {
    void handle((event as CustomEvent<InspectorAction>).detail).catch(report);
  };
  shell.addEventListener('ainotation-action', onAction);
  function destroy() {
    if (disposed) return;
    preferences.destroy();
    disposed = true;
    pageGeneration++;
    syncGeneration++;
    clearInterval(navigation);
    window.removeEventListener('popstate', reconcilePage);
    window.removeEventListener('hashchange', reconcilePage);
    sync?.stop();
    selection.destroy();
    markerLayer?.destroy();
    void store.close();
    shell.removeEventListener('ainotation-action', onAction);
    signal.removeEventListener('abort', destroy);
    downloads.destroy();
  }
  signal.addEventListener('abort', destroy, { once: true });
  function reconcilePage() {
    if (location.href === pageUrl || disposed) return false;
    pageUrl = location.href;
    pageKey = keyFor(pageUrl);
    record = null;
    view.document = null;
    view.draft = '';
    view.editingId = null;
    view.marker = null;
    view.editorOpen = false;
    selectionPage = null;
    editorVersion++;
    view.storage = 'loading';
    selection.setPicking(false);
    selection.resetPage();
    void loadPage().catch(report);
    return true;
  }
  try {
    if (options.mcp) connection = normalizeConnection(options.mcp);
    else {
      const saved = sessionStorage.getItem(credentialsKey);
      if (saved) connection = normalizeConnection(JSON.parse(saved) as McpConnection);
    }
    if (connection) view.endpoint = connection.endpoint;
  } catch {
    message('MCP settings could not be restored. Connect manually.');
  }
  try {
    await preferences.ready;
    await loadPage();
  } catch (error) {
    destroy();
    throw error;
  }
  if (disposed) return { getDocument: () => null, copy, destroy };
  window.addEventListener('popstate', reconcilePage, { signal });
  window.addEventListener('hashchange', reconcilePage, { signal });
  navigation = setInterval(reconcilePage, 500);
  return {
    getDocument(): FeedbackDocument | null {
      reconcilePage();
      return record ? structuredClone(record.document) : null;
    },
    copy,
    destroy,
  };
}
