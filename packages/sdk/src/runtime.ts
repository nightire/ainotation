import {
  AnnotationSchema,
  MAX_ANNOTATION_IMAGES,
  variantActive,
  variantAnnotations,
  type VariantAction,
} from '@ainotation/schema';
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
import { emptyViewState, type InspectorAction, type EditorPresentation } from './core/types';
import { createMarkerLayer } from './ui/markers';
import { bindPreferences } from './runtime-preferences';
import { copyProjectFeedback, createFeedbackDownloads } from './core/handoff';
import { developmentBridge, type DevelopmentConnection } from './core/development';
import { requestCapture } from './core/capture';
import { describeImage } from './core/images';
import { themeStyles } from './ui/theme';
import { targetLocatorText } from './ui/target-description';
import { createStyleEditor } from './core/style-editor';
import { createVariantsController, overlappingVariantTargets } from './core/variants-controller';
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
  let styleEditor: ReturnType<typeof createStyleEditor> | undefined;
  let variants: ReturnType<typeof createVariantsController> | undefined;
  let editorViews: Record<string, EditorPresentation> = {};
  function rememberEditor() {
    if (!view.editorSessionId) return;
    editorViews[view.editorSessionId] = {
      tab: view.editorTab,
      targets: styleEditor?.editingTargets() ?? view.selected.map((target) => target.id),
      position: view.editorPosition ? { ...view.editorPosition } : null,
      navigation: {
        slots: selection.getNavigation(),
        referenceIds: (
          record?.document.annotations.find((annotation) => annotation.id === view.editorSessionId)
            ?.targets ?? mergeStyleTargets(view.selected)
        ).map((target) => target.id),
      },
    };
  }
  function restoreEditorPresentation(id: string) {
    view.editorSessionId = id;
    const presentation = editorViews[id] ?? record?.editorViews?.[id];
    view.editorTab = presentation?.tab ?? 'feedback';
    view.editorPosition = presentation?.position ? { ...presentation.position } : null;
    if (presentation) styleEditor?.selectScope(presentation.targets);
  }
  function restoreEditingSelection(fallback: TargetSnapshot[], id: string, draft = false) {
    const saved = (editorViews[id] ?? record?.editorViews?.[id])?.navigation;
    const expectedIds = draft ? fallback.map((target) => target.id) : (saved?.referenceIds ?? []);
    const actualIds = draft
      ? (saved?.slots.map((slot) => slot.target.id) ?? [])
      : fallback.map((target) => target.id);
    // Only restore recorded navigation, never infer chains from current DOM nesting.
    // Agent edits that change the referenced targets invalidate the old grouping.
    const compatible =
      saved &&
      expectedIds.length === actualIds.length &&
      expectedIds.every((key) => actualIds.includes(key));
    adjustingTarget = true;
    try {
      if (compatible) {
        const latest = new Map(fallback.map((target) => [target.id, target]));
        const slots = saved.slots.map((slot) => ({
          target: structuredClone(latest.get(slot.target.id) ?? slot.target),
          history: slot.history.map((target) => structuredClone(latest.get(target.id) ?? target)),
        }));
        selection.restoreNavigation(slots);
        view.selected = slots.map((slot) => slot.target);
      } else {
        // Clear a previous marker's path even if both markers select the same node.
        selection.restoreNavigation(fallback.map((target) => ({ target, history: [] })));
        view.selected = structuredClone(fallback);
      }
    } finally {
      adjustingTarget = false;
    }
  }
  let pendingPicking: boolean | null = null;
  let storageReady = false;
  let navigation: ReturnType<typeof setInterval> | undefined;
  let connection: McpConnection | null = null;
  let projectRecovery: AbortController | undefined;
  let applySelectionState: (theme: string, comparing: boolean) => void = () => {};
  let sync: ReturnType<typeof createSyncClient> | undefined;
  function mergeStyleTargets(base: TargetSnapshot[]): TargetSnapshot[] {
    const result = styleEditor?.project(base) ?? structuredClone(base);
    for (const target of styleEditor?.changedTargets() ?? [])
      if (!result.some((item) => item.id === target.id)) result.push(target);
    return result;
  }
  const credentialsKey = `ainotation:mcp:${project}`;
  const render = () => {
    if (!disposed && !signal.aborted) {
      i18n.setLocale(view.locale);
      if (view.messageDescriptor) view.message = formatMessage(view.locale, view.messageDescriptor);
      if (styleEditor) {
        styleEditor.reconcile();
        view.styleTargetId = styleEditor.active();
        view.styleTargets = styleEditor.scopeTargets();
        view.styleEditor = styleEditor.state();
      }
      const exploring =
        record &&
        variantAnnotations(record.document).find((annotation) =>
          variantActive(annotation.variants),
        );
      const exploration = exploring?.variants;
      view.variantsComparing =
        !localOnly &&
        exploration?.status === 'published' &&
        exploration.manifest?.generation === exploration.generation;
      applySelectionState(view.theme, view.variantsComparing);
      const variantRoots = variants?.elements() ?? [];
      view.variantStyleBlocked =
        view.variantsRequested ||
        !!(
          view.editingId &&
          variantActive(
            record?.document.annotations.find((annotation) => annotation.id === view.editingId)
              ?.variants,
          )
        ) ||
        !!exploring?.variants?.targetIds.some((id) =>
          view.selected.some((target) => target.id === id),
        ) ||
        (!!exploring &&
          view.selected.some((target) => {
            const element = selection.getElement(target);
            return (
              !!element && variantRoots.some((root) => overlappingVariantTargets([root, element]))
            );
          }));
      view.variantPreview = variants?.state() ?? view.variantPreview;
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
        ...view.styleTargets,
        ...(record?.document.annotations.flatMap((annotation) => annotation.targets) || []),
      ].map((target) => [target.id, selection.availability(target)]),
    );
  }
  const selection = createSelection({
    onOutsideClick() {
      if (!view.editorOpen) return false;
      if (!saving && !drawing) void handle({ type: 'close-edit' }).catch(report);
      return true;
    },
    capture: (read) => (styleEditor ? styleEditor.capture(read) : read()),
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
      const retainRelated = !view.editingId && !!view.marker;
      if (retainRelated && mergeStyleTargets(targets).length > 20) {
        selection.setTargets(view.selected);
        message(msg('styleTargetLimit'));
        return;
      }
      editorVersion++;
      rememberEditor();
      const sessionId =
        view.editingId || !view.editorSessionId ? crypto.randomUUID() : view.editorSessionId;
      view.targetsAdjusted = false;
      if (view.editingId) {
        view.draft = '';
        view.images = [];
        view.variantsRequested = false;
      }
      view.editingId = null;
      view.selected = targets;
      styleEditor?.begin(targets, retainRelated);
      restoreEditorPresentation(sessionId);
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
      rememberEditor();
      view.editorSessionId = '';
      view.editorPosition = null;
      view.targetsAdjusted = false;
      if (view.editingId) {
        view.draft = '';
        view.images = [];
        view.variantsRequested = false;
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
  styleEditor = createStyleEditor((target) => selection.getElement(target), render);
  variants = createVariantsController({
    onChange() {
      if (!disposed && !reconcilePage()) render();
    },
    onReport(preview) {
      if (disposed || reconcilePage()) return false;
      const annotation = record?.document.annotations.find(
        (item) => item.id === view.variantAnnotationId,
      );
      const exploration = annotation?.variants;
      if (!annotation || !exploration || !view.variantsSupported || disposed) return false;
      void mutate({
        id: crypto.randomUUID(),
        kind: 'variants',
        annotationId: annotation.id,
        explorationId: exploration.id,
        generation: exploration.generation,
        revision: exploration.revision,
        action: { type: 'report', report: preview },
      }).catch(report);
    },
  });
  applySelectionState = (theme, comparing) => {
    selection.setTheme(theme);
    selection.setSuspended(comparing);
  };
  markerLayer = createMarkerLayer({
    onAction: (action) => {
      void handle(action).catch(report);
    },
    getRect: (target) => variants?.rect(target.id) ?? selection.getRect(target),
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

  function resetEditor(cancel = false) {
    rememberEditor();
    if (cancel) styleEditor?.cancel();
    styleEditor?.clearScope();
    view.editorTab = 'feedback';
    view.editorSessionId = '';
    view.editorPosition = null;
    drawing?.abort();
    editorVersion++;
    view.targetsAdjusted = false;
    view.targetNavigation = {};
    selectionPage = null;
    view.selected = [];
    view.draft = '';
    view.variantsRequested = false;
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
    const previousEditingVariants = record?.document.annotations.find(
      (annotation) => annotation.id === view.editingId,
    )?.variants;
    const editingVariants = next.document.annotations.find(
      (annotation) => annotation.id === view.editingId,
    )?.variants;
    if (variantActive(previousEditingVariants) && editingVariants?.status === 'completed')
      view.variantsRequested = false;
    const previousExplorationId =
      record &&
      variantAnnotations(record.document).find(
        (annotation) => annotation.id === view.variantAnnotationId,
      )?.variants?.id;
    const deletedExploration = next.document.variantCleanups?.some(
      (entry) =>
        entry.id === view.variantAnnotationId &&
        record?.document.annotations.some((annotation) => annotation.id === entry.id),
    );
    record = next;
    view.variantPosition = next.variantPosition ? { ...next.variantPosition } : null;
    const exploring =
      variantAnnotations(next.document).find((annotation) => variantActive(annotation.variants)) ??
      variantAnnotations(next.document).find(
        (annotation) => annotation.id === view.variantAnnotationId && annotation.variants,
      );
    if (
      view.variantAnnotationId !== (exploring?.id ?? '') ||
      deletedExploration ||
      previousExplorationId !== exploring?.variants?.id
    )
      view.variantMinimized = false;
    view.variantAnnotationId = exploring?.id ?? '';
    view.variantFeedback =
      next.variantFeedback?.explorationId === exploring?.variants?.id
        ? (next.variantFeedback?.text ?? '')
        : '';
    variants?.sync(localOnly ? undefined : exploring?.variants);
    styleEditor?.holdForVariants(
      exploring && variantActive(exploring.variants)
        ? exploring.variants!.targetIds
        : view.variantsRequested
          ? view.selected.map((target) => target.id)
          : [],
    );
    styleEditor?.sync(next.document);
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
      styleEditor?.cancel();
      styleEditor?.clearScope();
      view.editingId = null;
      view.editorSessionId = '';
      view.editorPosition = null;
      view.editorOpen = false;
      view.variantsRequested = false;
      view.marker = null;
      selection.clear();
      view.messageDescriptor = msg('annotationDeleted');
    }
    updateAvailability();
    render();
  }
  function snapshotDraft(): DraftRecord['draft'] {
    const previous = record?.document.annotations.find(
      (annotation) => annotation.id === view.editingId,
    )?.variants;
    return {
      text: view.draft,
      ...(view.variantsRequested ? { variantsRequested: true } : {}),
      ...(view.variantsRequested && previous?.status === 'completed'
        ? { variantRequestBase: previous.id }
        : {}),
      images: structuredClone(view.images),
      editingId: view.editingId,
      targets: view.editorOpen
        ? mergeStyleTargets(view.selected).slice(0, view.selected.length)
        : selection.getTargets(),
      ...(view.marker ? { marker: view.marker } : {}),
      ...(selectionPage ? { page: selectionPage } : {}),
      editorOpen: view.editorOpen,
      ...(view.targetsAdjusted ? { targetsAdjusted: true } : {}),
      ...(view.editorSessionId ? { editorSessionId: view.editorSessionId } : {}),
      ...(styleEditor?.changedTargets().length
        ? { styleTargets: styleEditor.changedTargets() }
        : {}),
    };
  }
  async function saveDraft() {
    rememberEditor();
    const token = pageGeneration;
    const draft = snapshotDraft();
    const styleDrafts = styleEditor?.drafts() ?? [];
    const stylePreview = styleEditor?.preference();
    const presentations = structuredClone(editorViews);
    const next = await store.update(pageKey, pageUrl, (current) => ({
      ...current,
      draft,
      styleDrafts,
      ...(stylePreview ? { stylePreview } : {}),
      editorViews: Object.fromEntries(
        Object.entries({ ...current.editorViews, ...presentations }).filter(
          ([id]) =>
            id === draft.editorSessionId ||
            current.document.annotations.some((annotation) => annotation.id === id),
        ),
      ),
    }));
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
    view.variantsSupported = false;
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
        if (response.variantConflicts?.length && token === syncGeneration && !disposed) {
          view.variantConflict = true;
          message(msg('variantsConflict'));
        }
      },
      onVariantsSupport(supported) {
        if (token === syncGeneration && !disposed) {
          view.variantsSupported = supported;
          render();
        }
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
    editorViews = structuredClone(next.editorViews ?? {});
    view.draft = next.draft.text;
    view.variantsRequested = next.draft.variantsRequested ?? false;
    view.images = structuredClone(next.draft.images ?? []);
    view.editingId =
      next.draft.editingId &&
      next.document.annotations.some((annotation) => annotation.id === next.draft.editingId)
        ? next.draft.editingId
        : null;
    const editingVariants = next.document.annotations.find(
      (annotation) => annotation.id === view.editingId,
    )?.variants;
    if (
      editingVariants?.status === 'completed' &&
      next.draft.variantRequestBase !== editingVariants.id
    )
      view.variantsRequested = false;
    const sessionId =
      view.editingId ??
      next.draft.editorSessionId ??
      ((next.draft.editorOpen ?? next.draft.targets.length > 0) ? crypto.randomUUID() : '');
    restoreEditingSelection(next.draft.targets, sessionId, true);
    view.marker = next.draft.marker ?? fallbackAnchor(next.draft.targets);
    view.editorOpen = next.draft.editorOpen ?? next.draft.targets.length > 0;
    view.targetsAdjusted = next.draft.targetsAdjusted ?? false;
    styleEditor?.reset();
    styleEditor?.restorePreference(next.stylePreview);
    styleEditor?.sync(next.document);
    styleEditor?.loadDrafts(next.styleDrafts ?? next.draft.styleTargets ?? []);
    styleEditor?.begin([
      ...(next.document.annotations.find((annotation) => annotation.id === view.editingId)
        ?.targets ?? []),
      ...(next.draft.styleTargets ?? []),
    ]);
    styleEditor?.begin(view.selected, true);
    restoreEditorPresentation(sessionId);
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
    let exceededLimit = false;
    const editingScope = styleEditor?.editingTargets() ?? [];
    adjustingTarget = true;
    try {
      styleEditor?.capture(() => {
        adjusted = selection.navigateTarget(action.id, action.direction, (targets) => {
          exceededLimit = mergeStyleTargets(targets).length > 20;
          return !exceededLimit;
        });
        if (!adjusted) return;
        view.selected = selection.getTargets();
        styleEditor.begin(view.selected, true);
        styleEditor.selectScope(
          editingScope.map((id) => (id === action.id ? view.selected[index]!.id : id)),
        );
      });
    } finally {
      adjustingTarget = false;
    }
    if (!adjusted) {
      if (exceededLimit) message(msg('styleTargetLimit'));
      return;
    }
    editorVersion++;
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
  function validateVariantTargets(targets: TargetSnapshot[]) {
    const elements = targets.map((target) => selection.getElement(target));
    if (
      !elements.length ||
      elements.some(
        (element) =>
          !(element instanceof Element) ||
          !element.getBoundingClientRect().width ||
          !element.getBoundingClientRect().height,
      ) ||
      overlappingVariantTargets(
        elements.filter((element): element is Element => element instanceof Element),
      )
    )
      throw uiError('variantsInvalidTargets');
  }
  async function handleVariantAction(action: InspectorAction) {
    if (!record) throw uiError('feedbackLoading');
    if (action.type === 'variant-minimized') {
      view.variantMinimized = action.value;
      render();
      return;
    }
    if (action.type === 'variant-position') {
      if (!Number.isFinite(action.position.x) || !Number.isFinite(action.position.y)) return;
      const token = pageGeneration;
      const next = await store.update(pageKey, pageUrl, (current) => ({
        ...current,
        variantPosition: { ...action.position },
      }));
      if (token === pageGeneration && !disposed) accept(next);
      return;
    }
    if (action.type === 'variants-toggle') {
      if (
        saving ||
        variantActive(
          record.document.annotations.find((item) => item.id === view.editingId)?.variants,
        )
      )
        return;
      if (action.value) {
        if (localOnly || !view.variantsSupported || view.connection !== 'connected')
          throw uiError('variantsNeedsConnection');
        if (
          variantAnnotations(record.document).some((annotation) =>
            variantActive(annotation.variants),
          )
        )
          throw uiError('variantsBusy');
        validateVariantTargets(view.selected);
      }
      view.variantsRequested = action.value;
      editorVersion++;
      styleEditor?.holdForVariants(action.value ? view.selected.map((target) => target.id) : []);
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'variant-preview') {
      variants?.select(action.value);
      view.variantConflict = false;
      render();
      return;
    }
    if (action.type === 'variant-feedback') {
      const id = record.document.annotations.find((item) => item.id === view.variantAnnotationId)
        ?.variants?.id;
      if (!id) return;
      view.variantFeedback = action.value.slice(0, 10000);
      const token = pageGeneration;
      const next = await store.update(pageKey, pageUrl, (current) => ({
        ...current,
        variantFeedback: { explorationId: id, text: action.value.slice(0, 10000) },
      }));
      if (token === pageGeneration) accept(next);
      return;
    }
    if (action.type === 'variant-decision') {
      if (view.variantSaving || localOnly) return;
      const annotation = record.document.annotations.find(
        (item) => item.id === view.variantAnnotationId,
      );
      const exploration = annotation?.variants;
      if (!annotation || !exploration) return;
      const preview = variants!.state();
      if (
        action.decision === 'accept' &&
        (preview.status !== 'ready' || preview.generation !== exploration.generation)
      )
        throw uiError('variantsBindingError');
      const decision: VariantAction =
        action.decision === 'accept'
          ? { type: 'accept', variantId: preview.variantId, feedback: view.variantFeedback }
          : { type: action.decision, feedback: view.variantFeedback };
      view.variantSaving = true;
      view.variantConflict = false;
      const submittedFeedback = view.variantFeedback;
      const token = pageGeneration;
      const key = pageKey;
      const url = pageUrl;
      render();
      try {
        await mutate({
          id: crypto.randomUUID(),
          kind: 'variants',
          annotationId: annotation.id,
          explorationId: exploration.id,
          generation: exploration.generation,
          revision: exploration.revision,
          action: decision,
        });
        const next = await store.update(key, url, (current) => {
          if (
            current.variantFeedback?.explorationId === exploration.id &&
            current.variantFeedback.text === submittedFeedback
          )
            delete current.variantFeedback;
          return current;
        });
        if (token !== pageGeneration || disposed) return;
        accept(next);
        message(msg('variantsDecisionSaved'));
      } finally {
        view.variantSaving = false;
        render();
      }
      return;
    }
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
      if (!action.value) {
        drawing?.abort();
      }
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
    if (
      action.type === 'variants-toggle' ||
      action.type === 'variant-preview' ||
      action.type === 'variant-feedback' ||
      action.type === 'variant-position' ||
      action.type === 'variant-minimized' ||
      action.type === 'variant-decision'
    ) {
      await handleVariantAction(action);
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
    if (action.type === 'editor-tab') {
      view.editorTab = action.value;
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'editor-position') {
      if (!Number.isFinite(action.position.x) || !Number.isFinite(action.position.y)) return;
      view.editorPosition = { ...action.position };
      await saveDraft();
      return;
    }
    if (action.type === 'style-target') {
      styleEditor?.select(action.id);
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'global-style-preview') {
      styleEditor?.global(action.value);
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'style-preview') {
      if (view.variantStyleBlocked) throw uiError('variantsStylesPaused');
      if (view.editorOpen && !saving && !drawing) styleEditor?.preview(action.value, action.force);
      render();
      await saveDraft();
      return;
    }
    if (
      action.type === 'style-change' ||
      action.type === 'style-step' ||
      action.type === 'style-reset' ||
      action.type === 'style-history'
    ) {
      if (!view.editorOpen || saving || drawing || !styleEditor) return;
      if (view.variantStyleBlocked) throw uiError('variantsStylesPaused');
      if (
        action.type === 'style-change' &&
        !styleEditor.edit(action.property, action.value, action.linked)
      ) {
        message(msg('styleInvalid'));
        return;
      }
      if (
        action.type === 'style-step' &&
        !styleEditor.step(action.property, action.direction, action.coarse, action.linked)
      ) {
        message(msg('styleInvalid'));
        return;
      }
      if (action.type === 'style-reset') styleEditor.remove(action.property, action.linked);
      if (action.type === 'style-history') styleEditor.history(action.direction);
      editorVersion++;
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'navigate-target') {
      if (
        view.variantsRequested ||
        record.document.annotations.find((item) => item.id === view.editingId)?.variants
      )
        throw uiError('variantsInvalidTargets');
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
      resetEditor(true);
      await saveDraft();
      return;
    }
    if (action.type === 'close-edit') {
      drawing?.abort();
      view.editorOpen = false;
      render();
      await saveDraft();
      return;
    }
    if (action.type === 'open-edit') {
      view.editorOpen = !!view.marker;
      render();
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
        styleEditor?.discardAll();
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
      const startingVariants =
        view.variantsRequested &&
        !variantActive(
          record.document.annotations.find((annotation) => annotation.id === view.editingId)
            ?.variants,
        );
      if (startingVariants) {
        const original = record.document.annotations.find(
          (annotation) => annotation.id === view.editingId,
        );
        validateVariantTargets(
          mergeStyleTargets(
            view.targetsAdjusted ? view.selected : (original?.targets ?? view.selected),
          ),
        );
      }
      if (
        startingVariants &&
        (localOnly || !view.variantsSupported || view.connection !== 'connected')
      )
        throw uiError('variantsNeedsConnection');
      if (
        startingVariants &&
        variantAnnotations(record.document).some((annotation) => variantActive(annotation.variants))
      )
        throw uiError('variantsBusy');
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
          view.editorSessionId = crypto.randomUUID();
          await saveDraft();
          message(msg('originalDeleted'));
          return;
        }
        const now = new Date().toISOString();
        const annotation: Annotation = AnnotationSchema.parse({
          id: existing?.id || view.editorSessionId || crypto.randomUUID(),
          comment:
            draft.trim() ||
            (view.variantsRequested
              ? formatMessage(view.locale, msg('variantsEmptyComment'))
              : '') ||
            (styleEditor && (styleEditor.state().count || styleEditor.state().dirty)
              ? formatMessage(view.locale, msg('styleOnlyFeedback'))
              : draft),
          createdAt: existing?.createdAt || now,
          updatedAt: now,
          page: submittedDraft.targetsAdjusted
            ? (submittedDraft.page ?? capturePage())
            : (existing?.page ?? selectionPage ?? capturePage()),
          targets: mergeStyleTargets(
            submittedDraft.targetsAdjusted
              ? submittedDraft.targets
              : (existing?.targets ?? structuredClone(view.selected)),
          ),
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
          ...(startingVariants && existing?.variants ? { variants: existing.variants } : {}),
          ...(view.images.length ? { images: structuredClone(view.images) } : {}),
        });
        await mutate(
          {
            id: crypto.randomUUID(),
            kind: 'upsert',
            annotation,
            styleLinks: styleEditor?.links() ?? {},
            ...(startingVariants ? { variantRequest: crypto.randomUUID() } : {}),
          },
          submittedDraft,
        );
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
      if (annotation.id === view.variantAnnotationId) view.variantConflict = false;
      if (view.editingId === annotation.id) {
        view.editorOpen = true;
        render();
        await saveDraft();
        return;
      }
      rememberEditor();
      styleEditor?.begin(annotation.targets);
      restoreEditingSelection(annotation.targets, annotation.id);
      styleEditor?.begin(view.selected, true);
      restoreEditorPresentation(annotation.id);
      editorVersion++;
      view.targetsAdjusted = view.selected.some(
        (target) => !annotation.targets.some((saved) => saved.id === target.id),
      );
      view.message = '';
      delete view.messageDescriptor;
      view.editingId = annotation.id;
      view.draft = annotation.comment;
      view.variantsRequested = variantActive(annotation.variants);
      view.images = structuredClone(annotation.images ?? []);
      view.marker = annotation.marker ?? fallbackAnchor(annotation.targets);
      view.editorOpen = true;
      selectionPage = annotation.page;
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
    styleEditor?.destroy();
    variants?.destroy();
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
    styleEditor?.reset();
    variants?.sync();
    view.variantAnnotationId = '';
    view.variantsRequested = false;
    view.variantFeedback = '';
    view.variantPosition = null;
    view.variantMinimized = false;
    view.variantConflict = false;
    editorViews = {};
    view.editorSessionId = '';
    view.editorPosition = null;
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
  window.addEventListener('pagehide', () => styleEditor?.suspend(), { signal });
  window.addEventListener('pageshow', () => styleEditor?.resume(), { signal });
  return {
    getDocument(): FeedbackDocument | null {
      reconcilePage();
      return record ? structuredClone(record.document) : null;
    },
    copy,
    destroy,
  };
}
