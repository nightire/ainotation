import { AnnotationSchema, MAX_ANNOTATION_IMAGES } from '@ainotation/schema';
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
import { developmentBridge, type DevelopmentConnection } from './core/development';
import { requestCapture } from './core/capture';
import { describeImage } from './core/images';
import { themeStyles } from './ui/theme';
import { targetLocatorText } from './ui/target-description';
import {
  createI18n,
  detectLocale,
  formatMessage,
  errorMessage,
  msg,
  uiError,
  type UiMessage,
} from './i18n';

export async function createRuntime(
  shell: InspectorShell,
  options: { projectId?: string; mcp?: McpConnection | false; development?: DevelopmentConnection },
  signal: AbortSignal,
) {
  const view = emptyViewState();
  const i18n = createI18n(detectLocale());
  view.locale = i18n.locale;
  let disposed = false;
  let record: DraftRecord | null = null;
  let pageUrl = location.href;
  const project = options.projectId || location.origin;
  const localOnly = options.mcp === false;
  if (localOnly && options.development)
    throw new Error('Local-only mode (mcp: false) cannot use a development bridge.');
  if (options.development && options.mcp)
    throw new Error('Choose either a development bridge or a manual MCP connection.');
  const development = options.development
    ? developmentBridge(options.development, project, signal)
    : undefined;
  view.managedConnection = !!development;
  view.localOnly = localOnly;
  if (localOnly) view.endpoint = '';
  view.projectName = options.development?.projectName ?? '';
  const keyFor = (url: string) => JSON.stringify([project, url]);
  let pageKey = keyFor(pageUrl);
  let pageGeneration = 0;
  let syncGeneration = 0;
  let saving = false;
  let editorVersion = 0;
  let adjustingTarget = false;
  let selectionPage: PageSnapshot | null = null;
  let drawing: AbortController | null = null;
  const imageUrls = new Map<string, string>();
  let markerLayer: ReturnType<typeof createMarkerLayer> | undefined;
  let pendingPicking: boolean | null = null;
  let storageReady = false;
  let navigation: ReturnType<typeof setInterval> | undefined;
  let connection: McpConnection | null = null;
  let projectRecovery: AbortController | undefined;
  let applySelectionTheme: (theme: string) => void = () => {};
  let sync: ReturnType<typeof createSyncClient> | undefined;
  const credentialsKey = `ainotation:mcp:${project}`;
  const render = () => {
    if (!disposed && !signal.aborted) {
      i18n.setLocale(view.locale);
      if (view.messageDescriptor) view.message = formatMessage(view.locale, view.messageDescriptor);
      applySelectionTheme(view.theme);
      for (const [id, url] of imageUrls) {
        if (!view.images.some((image) => image.id === id)) {
          URL.revokeObjectURL(url);
          imageUrls.delete(id);
        }
      }
      for (const image of view.images) {
        const blob = record?.images?.[image.id];
        if (blob && !imageUrls.has(image.id)) imageUrls.set(image.id, URL.createObjectURL(blob));
      }
      view.imageUrls = Object.fromEntries(imageUrls);
      shell.view = {
        ...view,
        selected: [...view.selected],
        availability: { ...view.availability },
      };
      markerLayer?.update(shell.view, !drawing && shell.expanded && view.storage !== 'loading');
    }
  };
  const message = (text: string | UiMessage) => {
    if (typeof text === 'string') delete view.messageDescriptor;
    else view.messageDescriptor = text;
    view.message = formatMessage(view.locale, text);
    render();
  };
  const report = (error: unknown) => message(errorMessage(error));
  render();
  const preferences = bindPreferences(shell, project, view, signal, render, message);

  const store = await createDraftStore({
    onUnavailable() {
      view.storage = 'unavailable';
      message(msg('storageUnavailable'));
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
    view.targetNavigation = Object.fromEntries(
      view.selected.map((target) => [target.id, selection.targetNavigation(target.id)]),
    );
    view.availability = Object.fromEntries(
      [
        ...view.selected,
        ...(record?.document.annotations.flatMap((annotation) => annotation.targets) || []),
      ].map((target) => [target.id, selection.availability(target)]),
    );
  }
  const selection = createSelection({
    visible: shell.expanded,
    appearance: { theme: view.theme, cssText: themeStyles.cssText },
    onChange() {
      if (disposed || adjustingTarget) return;
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
      view.targetsAdjusted = false;
      if (view.editingId) {
        view.draft = '';
        view.images = [];
      }
      view.editingId = null;
      view.selected = targets;
      selectionPage = capturePage();
      view.marker = anchor;
      view.editorOpen = true;
      view.message = '';
      delete view.messageDescriptor;
      updateAvailability();
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
      view.targetsAdjusted = false;
      if (view.editingId) {
        view.draft = '';
        view.images = [];
      }
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
  applySelectionTheme = (theme) => selection.setTheme(theme);
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
    drawing?.abort();
    editorVersion++;
    view.targetsAdjusted = false;
    view.targetNavigation = {};
    selectionPage = null;
    view.selected = [];
    view.draft = '';
    view.images = [];
    view.editingId = null;
    view.editorOpen = false;
    view.marker = null;
    selection.clear();
    render();
  }

  function accept(next: DraftRecord) {
    view.recoveryNeeded = !!next.syncRecovery;
    if (next.syncRecovery?.server) view.recoveredDocument = next.syncRecovery.server;
    else delete view.recoveredDocument;
    view.hasRecoveryCopy = !!next.recoveryCopies?.length;
    if (disposed) return;
    if (reconcilePage() || next.document.url !== pageUrl) return;
    record = next;
    view.document = next.document;
    view.storage = store.available ? 'ready' : 'unavailable';
    if (!view.editorOpen && !view.draft && next.draft.text && !next.draft.editorOpen) {
      view.draft = next.draft.text;
      view.images = structuredClone(next.draft.images ?? []);
      view.messageDescriptor = msg('remoteDeleted');
    }
    if (
      view.editingId &&
      !next.document.annotations.some((annotation) => annotation.id === view.editingId)
    ) {
      drawing?.abort();
      view.editingId = null;
      view.editorOpen = false;
      view.marker = null;
      selection.clear();
      view.messageDescriptor = msg('annotationDeleted');
    }
    updateAvailability();
    render();
  }
  function snapshotDraft(): DraftRecord['draft'] {
    return {
      text: view.draft,
      images: structuredClone(view.images),
      editingId: view.editingId,
      targets: view.editorOpen ? structuredClone(view.selected) : selection.getTargets(),
      ...(view.marker ? { marker: view.marker } : {}),
      ...(selectionPage ? { page: selectionPage } : {}),
      editorOpen: view.editorOpen,
      ...(view.targetsAdjusted ? { targetsAdjusted: true } : {}),
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
  async function startSync(recovery?: import('@ainotation/schema').SyncRequest['recovery']) {
    sync?.stop();
    sync = undefined;
    const token = ++syncGeneration;
    if (localOnly || !record || (!connection && !development) || disposed) return;
    const key = pageKey;
    const url = pageUrl;
    const currentConnection = connection;
    view.connection = 'connecting';
    render();
    const bound = await store.bindAuthority(
      key,
      url,
      development?.authority ?? currentConnection!.endpoint,
    );
    if (token !== syncGeneration || disposed) return;
    accept(bound);
    if (token !== syncGeneration || disposed) return;
    sync = createSyncClient({
      connection: development
        ? (syncSignal) => development.resolve(syncSignal)
        : currentConnection!,
      sessionId: bound.document.id,
      recovery,
      async onRecovery(response) {
        if (token !== syncGeneration || disposed || !response.storageEpoch || !response.recovery)
          return;
        const next = await store.update(key, url, (record) => ({
          ...record,
          syncRecovery: {
            epoch: response.storageEpoch!,
            revision: response.recovery!.revision,
            server: response.document,
          },
        }));
        if (token === syncGeneration && !disposed) accept(next);
      },
      read: () => store.read(key, url),
      async apply(response, images) {
        if (token !== syncGeneration || disposed) return;
        const next = await store.applySync(key, url, response, images);
        if (token === syncGeneration && !disposed) accept(next);
      },
      onState(state, text) {
        if (token === syncGeneration && !disposed) {
          view.connection = state;
          if (state === 'error') view.syncProblem = text;
          else delete view.syncProblem;
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
    view.images = structuredClone(next.draft.images ?? []);
    view.editingId =
      next.draft.editingId &&
      next.document.annotations.some((annotation) => annotation.id === next.draft.editingId)
        ? next.draft.editingId
        : null;
    selection.setTargets(next.draft.targets);
    view.marker = next.draft.marker ?? fallbackAnchor(next.draft.targets);
    view.editorOpen = next.draft.editorOpen ?? next.draft.targets.length > 0;
    view.selected = structuredClone(next.draft.targets);
    view.targetsAdjusted = next.draft.targetsAdjusted ?? false;
    selectionPage = next.draft.page ?? (view.editorOpen ? capturePage() : null);
    selection.setVisible(shell.expanded);
    accept(next);
    selection.setPicking(pendingPicking ?? shell.expanded);
    pendingPicking = null;
    await startSync();
  }
  function disconnect() {
    if (localOnly) return;
    projectRecovery?.abort();
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
    delete view.syncProblem;
    message(msg('localOnly'));
  }
  async function connect(value: McpConnection) {
    if (localOnly) return;
    projectRecovery?.abort();
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
  async function recoverProject() {
    if (localOnly || view.recoveringProject || (!connection && !development)) return;
    const controller = new AbortController();
    projectRecovery = controller;
    const recoverySignal = AbortSignal.any([signal, controller.signal]);
    const currentConnection = connection;
    view.recoveringProject = true;
    view.recoveryPages = [];
    render();
    try {
      const documents = await store.readProjectDocuments(project);
      for (
        let index = 0;
        index < documents.length && !disposed && !recoverySignal.aborted;
        index++
      ) {
        const document = documents[index]!;
        const key = keyFor(document.url);
        const bound = await store.bindAuthority(
          key,
          document.url,
          development?.authority ?? currentConnection!.endpoint,
        );
        if (disposed || recoverySignal.aborted) return;
        let failed = false;
        const client = createSyncClient({
          connection: development ? (signal) => development.resolve(signal) : currentConnection!,
          sessionId: bound.document.id,
          once: true,
          read: () => store.read(key, document.url),
          async apply(response, images) {
            const next = await store.applySync(key, document.url, response, images);
            if (key === pageKey && !disposed) accept(next);
          },
          async onRecovery(response) {
            if (!response.storageEpoch || !response.recovery) return;
            const next = await store.update(key, document.url, (record) => ({
              ...record,
              syncRecovery: {
                server: response.document,
                epoch: response.storageEpoch!,
                revision: response.recovery!.revision,
              },
            }));
            if (key === pageKey && !disposed) accept(next);
          },
          onState(state) {
            if (state === 'error') failed = true;
          },
          onSync() {},
        });
        const stop = () => client.stop();
        recoverySignal.addEventListener('abort', stop, { once: true });
        try {
          await client.finished;
        } finally {
          client.stop();
          recoverySignal.removeEventListener('abort', stop);
        }
        if (disposed || recoverySignal.aborted) return;
        if (failed) view.recoveryPages.push(document.url);
        message(msg('syncProjectProgress', index + 1, documents.length));
      }
      if (view.recoveryPages.length) message(msg('syncProjectReview'));
    } finally {
      if (projectRecovery === controller) projectRecovery = undefined;
      view.recoveringProject = false;
      render();
    }
  }
  async function navigateTarget(action: Extract<InspectorAction, { type: 'navigate-target' }>) {
    if (!view.editorOpen || saving || drawing) return;
    const anchor = view.marker;
    const oldTarget = view.selected.find((target) => target.id === action.id);
    const rect = oldTarget && selection.getRect(oldTarget);
    const point = anchor
      ? {
          x:
            rect && anchor.targetId === action.id && Number.isFinite(anchor.ratioX)
              ? rect.x + rect.width * anchor.ratioX!
              : anchor.x - (anchor.space === 'document' ? scrollX : 0),
          y:
            rect && anchor.targetId === action.id && Number.isFinite(anchor.ratioY)
              ? rect.y + rect.height * anchor.ratioY!
              : anchor.y - (anchor.space === 'document' ? scrollY : 0),
        }
      : null;
    const index = view.selected.findIndex((target) => target.id === action.id);
    if (index < 0) return;
    let adjusted = false;
    adjustingTarget = true;
    try {
      adjusted = selection.navigateTarget(action.id, action.direction);
    } finally {
      adjustingTarget = false;
    }
    if (!adjusted) return;
    editorVersion++;
    view.selected = selection.getTargets();
    view.message = '';
    delete view.messageDescriptor;
    const original = view.document?.annotations.find(
      (annotation) => annotation.id === view.editingId,
    );
    view.targetsAdjusted =
      !original ||
      original.targets.length !== view.selected.length ||
      original.targets.some((target, index) => target.id !== view.selected[index]?.id);
    selectionPage = capturePage();
    if (anchor && point && anchor.targetId === action.id) {
      const replacement = view.selected[index]!;
      const bounds = selection.getRect(replacement) ?? replacement.rect;
      view.marker = {
        ...anchor,
        targetId: replacement.id,
        x: point.x + (anchor.space === 'document' ? scrollX : 0),
        y: point.y + (anchor.space === 'document' ? scrollY : 0),
        ratioX: bounds.width ? (point.x - bounds.x) / bounds.width : undefined,
        ratioY: bounds.height ? (point.y - bounds.y) / bounds.height : undefined,
      };
    }
    updateAvailability();
    render();
    await saveDraft();
  }
  async function copy() {
    if (reconcilePage()) throw uiError('pageLoading');
    if (!record) throw uiError('feedbackLoading');
    const output = await copyProjectFeedback(
      store.readProjectDocuments(project),
      record.document,
      view.outputDetail,
      () => !disposed && !signal.aborted,
    );
    message(msg('copied'));
    return output;
  }
  async function handle(action: InspectorAction) {
    if (disposed || signal.aborted) return;
    if (
      action.type === 'set-theme' ||
      action.type === 'set-output-detail' ||
      action.type === 'set-locale'
    ) {
      await preferences.update(action);
      return;
    }
    if (action.type === 'set-picking') {
      if (!action.value) drawing?.abort();
      pendingPicking = view.storage === 'loading' ? action.value : null;
      selection.setVisible(action.value && view.storage !== 'loading');
      selection.setPicking(action.value && view.storage !== 'loading');
      render();
      return;
    }
    if (reconcilePage() || view.storage === 'loading') {
      message(msg('pageLoading'));
      return;
    }
    if (action.type === 'connect') {
      if (development) return;
      await connect(action);
      return;
    }
    if (action.type === 'retry-sync' || action.type === 'resolve-recovery') {
      if (localOnly) return;
      const pending = record?.syncRecovery;
      await startSync(
        action.type === 'resolve-recovery' && pending
          ? { epoch: pending.epoch, revision: pending.revision, source: action.source }
          : undefined,
      );
      return;
    }
    if (action.type === 'recover-project') {
      await recoverProject();
      return;
    }
    if (action.type === 'export-recovery') {
      const copy = record?.recoveryCopies?.at(-1);
      if (copy) {
        if (copy.document.annotations.some((annotation) => annotation.images?.length))
          await downloads.exportImages(copy.document, copy.images);
        else downloads.exportJson(copy.document);
      }
      return;
    }
    if (action.type === 'disconnect') {
      if (development) return;
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
    if (!record) throw uiError('feedbackLoading');
    if (action.type === 'navigate-target') {
      await navigateTarget(action);
      return;
    }
    if (
      action.type === 'screenshot' ||
      action.type === 'import-image' ||
      action.type === 'edit-image'
    ) {
      if (drawing || saving || !view.editorOpen) return;
      if (action.type !== 'edit-image' && view.images.length >= MAX_ANNOTATION_IMAGES)
        throw uiError('imageLimit');
      const lifetime = new AbortController();
      drawing = lifetime;
      const drawingSignal = AbortSignal.any([signal, lifetime.signal]);
      const page = pageGeneration;
      const version = editorVersion;
      const previousVisibility = shell.style.visibility;
      const restore = () => {
        if (drawing !== lifetime) return;
        drawing = null;
        shell.style.visibility = previousVisibility;
        if (!disposed && page === pageGeneration) {
          selection.setVisible(shell.expanded);
          selection.setPicking(shell.expanded && view.storage !== 'loading');
          render();
        }
      };
      drawingSignal.addEventListener('abort', restore, { once: true });
      let stream: MediaStream | undefined;
      try {
        // Request before the lazy editor import; a later task loses browser activation.
        const pending = action.type === 'screenshot' ? requestCapture(drawingSignal) : null;
        selection.setPicking(false);
        selection.setVisible(false);
        shell.style.visibility = 'hidden';
        render();
        if (pending) stream = await pending;
        drawingSignal.throwIfAborted();
        const blob =
          action.type === 'import-image'
            ? action.file
            : action.type === 'edit-image'
              ? record.images?.[action.id]
              : undefined;
        if (!stream && !blob) throw uiError('imagePending');
        const { createDrawingEditor } = await import('./ui/drawing');
        drawingSignal.throwIfAborted();
        await createDrawingEditor({
          i18n,
          source: stream ? { stream } : { blob: blob! },
          theme: view.theme,
          signal: drawingSignal,
          async onSave(result) {
            const image = await describeImage(
              result,
              action.type === 'screenshot' ? 'screen' : 'import',
            );
            drawingSignal.throwIfAborted();
            if (reconcilePage() || page !== pageGeneration || version !== editorVersion)
              throw uiError('changedWhileDrawing');
            const previous = view.images;
            view.images =
              action.type === 'edit-image'
                ? previous.map((item) => (item.id === action.id ? image : item))
                : [...previous, image];
            try {
              const draft = snapshotDraft();
              const next = await store.update(pageKey, pageUrl, (current) => {
                drawingSignal.throwIfAborted();
                return { ...current, draft, images: { ...current.images, [image.id]: result } };
              });
              if (page === pageGeneration && !disposed) {
                accept(next);
                view.messageDescriptor = msg('imageAttached');
              }
            } catch (error) {
              if (page === pageGeneration && version === editorVersion && !disposed)
                view.images = previous;
              throw error;
            }
          },
          onClose: () => lifetime.abort(),
        });
      } catch (error) {
        stream?.getTracks().forEach((track) => track.stop());
        const cancelled =
          drawingSignal.aborted ||
          (error instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(error.name));
        lifetime.abort();
        if (!cancelled && page === pageGeneration) throw error;
      }
      return;
    }
    if (action.type === 'remove-image') {
      view.images = view.images.filter((image) => image.id !== action.id);
      editorVersion++;
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'download-image') {
      const blob = record.images?.[action.id];
      if (!blob) throw uiError('imagePending');
      downloads.download(blob, `${action.id}.png`);
      return;
    }
    if (action.type === 'copy') {
      await copy();
      return;
    }
    if (action.type === 'copy-selector') {
      const target = [
        ...view.selected,
        ...record.document.annotations.flatMap((annotation) => annotation.targets),
      ].find((target) => target.id === action.id);
      if (!target) throw uiError('missingAnnotation');
      try {
        await navigator.clipboard.writeText(targetLocatorText(target));
      } catch {
        throw uiError('clipboardFailed');
      }
      message(msg('selectorCopied'));
      return;
    }
    if (action.type === 'export') {
      const images = record.document.annotations.flatMap((annotation) => annotation.images ?? []);
      if (images.length) await downloads.exportImages(record.document, record.images ?? {});
      else downloads.exportJson(record.document);
      message(msg('exported'));
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
          message(msg('cleared'));
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
          message(msg('originalDeleted'));
          return;
        }
        const now = new Date().toISOString();
        const annotation: Annotation = AnnotationSchema.parse({
          id: existing?.id || crypto.randomUUID(),
          comment: draft,
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          page: submittedDraft.targetsAdjusted
            ? (submittedDraft.page ?? capturePage())
            : (existing?.page ?? selectionPage ?? capturePage()),
          targets: submittedDraft.targetsAdjusted
            ? submittedDraft.targets
            : (existing?.targets ?? structuredClone(view.selected)),
          ...(submittedDraft.targetsAdjusted
            ? submittedDraft.marker
              ? { marker: submittedDraft.marker }
              : {}
            : existing
              ? existing.marker
                ? { marker: existing.marker }
                : {}
              : view.marker
                ? { marker: view.marker }
                : {}),
          status: existing?.status || 'pending',
          replies: existing?.replies || [],
          ...(view.images.length ? { images: structuredClone(view.images) } : {}),
        });
        await mutate({ id: crypto.randomUUID(), kind: 'upsert', annotation }, submittedDraft);
        if (page === pageGeneration && version === editorVersion) {
          resetEditor();
          await saveDraft();
        }
        if (page === pageGeneration) message(msg('saved'));
      } finally {
        saving = false;
        view.saving = false;
        render();
      }
      return;
    }
    if (!('id' in action)) return;
    const annotation = record.document.annotations.find((item) => item.id === action.id);
    if (!annotation) throw uiError('missingAnnotation');
    if (action.type === 'edit') {
      editorVersion++;
      view.targetsAdjusted = false;
      view.message = '';
      delete view.messageDescriptor;
      view.editingId = annotation.id;
      view.draft = annotation.comment;
      view.images = structuredClone(annotation.images ?? []);
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
    projectRecovery?.abort();
    preferences.destroy();
    disposed = true;
    drawing?.abort();
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls.clear();
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
    drawing?.abort();
    pageUrl = location.href;
    pageKey = keyFor(pageUrl);
    record = null;
    view.document = null;
    view.draft = '';
    view.images = [];
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
    if (localOnly || development) {
      /* Local-only instances never restore credentials; development owns its own. */
    } else if (options.mcp) connection = normalizeConnection(options.mcp);
    else {
      const saved = sessionStorage.getItem(credentialsKey);
      if (saved) connection = normalizeConnection(JSON.parse(saved) as McpConnection);
    }
    if (connection) view.endpoint = connection.endpoint;
  } catch {
    message(msg('connectionRestoreFailed'));
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
