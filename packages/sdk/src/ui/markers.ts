import type { Annotation, MarkerAnchor, TargetSnapshot } from '@ainotation/schema';
import { css, html, nothing, render } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { Camera, ImagePlus, Download, Check, createElement, Pencil, Plus, Trash2, X } from 'lucide';

import type { InspectorAction, InspectorViewState } from '../core/types';
import { themeStyles } from './theme';
import { toolNode } from '../core/dom';
import { getViewport } from './position';
import { messages } from '../i18n';

type Rect = TargetSnapshot['rect'];
type Options = {
  onAction: (action: InspectorAction) => void;
  getRect: (target: TargetSnapshot) => Rect | null;
};

const styles = css`
  ${themeStyles}
  * {
    box-sizing: border-box;
  }
  .layer {
    color: var(--ain-text);
    font:
      13px/1.5 system-ui,
      sans-serif;
    letter-spacing: 0;
    text-align: left;
    color-scheme: var(--ain-scheme);
    direction: ltr;
  }
  [hidden] {
    display: none !important;
  }
  button,
  textarea {
    font: inherit;
  }
  button {
    appearance: none;
    padding: 5px 9px;
    border: 1px solid var(--ain-border);
    border-radius: 4px;
    background: var(--ain-surface);
    color: var(--ain-text);
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.45;
    cursor: default;
  }
  button:focus-visible,
  textarea:focus-visible {
    outline: 2px solid var(--ain-focus);
    outline-offset: 2px;
  }
  .primary {
    background: var(--ain-accent);
    border-color: var(--ain-accent);
    color: var(--ain-on-accent);
  }
  .primary:hover:not(:disabled) {
    background: var(--ain-accent-hover);
  }
  .actions button:not(.primary):hover:not(:disabled) {
    background: var(--ain-hover);
  }
  .marker {
    position: fixed;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    min-width: 24px;
    min-height: 24px;
    max-width: 24px;
    max-height: 24px;
    padding: 0;
    margin: 0;
    border: 1px solid var(--ain-on-accent);
    border-radius: 50%;
    background: var(--ain-accent);
    color: var(--ain-on-accent);
    font:
      600 12px/1 system-ui,
      sans-serif;
    transform: translate(-50%, -50%);
    pointer-events: auto;
  }
  .marker svg {
    width: 14px;
    height: 14px;
  }
  .passthrough .marker,
  .passthrough .popover,
  .passthrough .popover * {
    pointer-events: none !important;
  }
  .pencil {
    display: none;
  }
  .marker:hover .number,
  .marker:focus-visible .number {
    display: none;
  }
  .marker:hover .pencil,
  .marker:focus-visible .pencil {
    display: flex;
  }
  .popover {
    position: fixed;
    padding: 12px;
    border: 1px solid var(--ain-border);
    border-radius: 8px;
    background: var(--ain-surface);
    box-shadow: 0 4px 20px var(--ain-shadow);
    overflow: auto;
    overscroll-behavior: contain;
    pointer-events: auto;
  }
  .target-list {
    list-style: none;
    padding: 0;
    margin: 0 0 8px;
    max-height: 100px;
    overflow: auto;
    font:
      11px/1.5 ui-monospace,
      monospace;
    color: var(--ain-muted);
  }
  .target-list li {
    overflow-wrap: anywhere;
    padding: 2px 0;
  }
  .text-quote {
    display: block;
    margin-top: 4px;
    padding: 6px 8px;
    border-left: 2px solid var(--ain-quote-border);
    background: var(--ain-quote);
    font:
      12px/1.5 system-ui,
      sans-serif;
    white-space: pre-wrap;
  }
  textarea {
    display: block;
    width: 100%;
    min-width: 0;
    min-height: 80px;
    max-height: 240px;
    padding: 7px 8px;
    border: 1px solid var(--ain-field-border);
    border-radius: 4px;
    background: var(--ain-field);
    color: var(--ain-text);
    resize: vertical;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .actions button {
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .actions-end {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }
  .actions .danger {
    color: var(--ain-error);
    border-color: var(--ain-error);
  }
  .actions .danger:hover:not(:disabled) {
    background: var(--ain-error-surface);
  }
  .actions svg {
    width: 16px;
    height: 16px;
  }
  .message {
    margin: 8px 0 0;
    overflow-wrap: anywhere;
    color: var(--ain-message);
  }
  .images {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
    margin-top: 8px;
  }
  .image {
    position: relative;
    width: 84px;
    height: 64px;
  }
  .image img {
    width: 76px;
    height: 56px;
    object-fit: contain;
    display: block;
  }
  .image-preview {
    display: block;
    width: 100%;
    height: 100%;
    padding: 3px;
  }
  .image svg {
    width: 14px;
    height: 14px;
  }
  .image-action {
    opacity: 0;
    pointer-events: none;
    position: absolute;
    right: 3px;
    z-index: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    box-shadow: 0 1px 3px var(--ain-shadow);
  }
  .image-action:hover:not(:disabled) {
    background: var(--ain-hover);
  }
  .image:hover .image-action,
  .image:focus-within .image-action {
    opacity: 1;
    pointer-events: auto;
  }
  @media (hover: none) {
    .image-action {
      opacity: 1;
      pointer-events: auto;
    }
  }
  .image-remove {
    top: 3px;
  }
  .image-download {
    bottom: 3px;
  }
  .import-hint {
    font-size: 11px;
    color: var(--ain-muted);
    margin: 8px 0 0;
  }
`;

export function createMarkerLayer({ onAction, getRect }: Options): {
  update(view: InspectorViewState, visible: boolean): void;
  destroy(): void;
} {
  const host = document.createElement('div');
  host.setAttribute('data-ainotation-ui', 'markers');
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important;display:none!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  (document.body ?? document.documentElement).append(host);
  let view: InspectorViewState | null = null;
  let visible = false;
  let destroyed = false;
  let frame = 0;
  let editorKey: string | null = null;
  let editorId: string | null = null;
  let annotationIds = new Set<string>();
  const abort = new AbortController();
  const observedElements = new Set<Element>();
  const observedRoots = new Set<Document | ShadowRoot>();

  function schedule() {
    if (visible && !destroyed && !frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        position();
      });
    }
  }

  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver((records) => {
    if (
      records.some(
        (record) =>
          !toolNode(record.target) &&
          (record.type !== 'childList' ||
            [...record.addedNodes, ...record.removedNodes].some((node) => !toolNode(node))),
      )
    ) {
      schedule();
    }
  });

  function position() {
    if (!view || !visible || destroyed) return;
    const m = messages(view.locale);
    const roots = new Set<Document | ShadowRoot>([document]);
    const elements = new Set<Element>();
    const rectangles = new Map<TargetSnapshot, Rect | null>();
    const annotations = view.document?.annotations ?? [];
    for (const target of [
      ...annotations.flatMap((annotation) => annotation.targets),
      ...view.selected,
    ]) {
      if (rectangles.has(target)) continue;
      let rect: Rect | null = null;
      try {
        const candidate = getRect(target);
        if (
          candidate &&
          [candidate.x, candidate.y, candidate.width, candidate.height].every(Number.isFinite)
        ) {
          rect = candidate;
        }
      } catch {
        // Detached or inaccessible targets retain their captured anchor.
      }
      rectangles.set(target, rect);
      // Selectors are used only for observation; getRect owns target identity and geometry.
      try {
        let root: Document | ShadowRoot = document;
        let reachable = true;
        for (const selector of target.shadowHosts) {
          const matches: NodeListOf<Element> = root.querySelectorAll(selector);
          const candidate = matches.length === 1 ? matches[0] : null;
          if (!candidate?.shadowRoot || toolNode(candidate)) {
            reachable = false;
            break;
          }
          root = candidate.shadowRoot;
          roots.add(root);
        }
        if (!reachable) continue;
        const matches = root.querySelectorAll(target.selector);
        const element = matches.length === 1 ? matches[0] : null;
        if (rect && element && element.localName === target.tagName && !toolNode(element)) {
          elements.add(element);
        }
      } catch {
        // Invalid or ambiguous selectors must never substitute another target.
      }
    }

    function point(
      anchor: MarkerAnchor | undefined,
      targets: TargetSnapshot[],
      annotation?: Annotation,
    ) {
      const last = targets.at(-1);
      if (!anchor && last && annotation) {
        anchor = {
          x: last.rect.x + last.rect.width + annotation.page.viewport.scrollX,
          y: last.rect.y + last.rect.height + annotation.page.viewport.scrollY,
          space: 'document',
          targetId: last.id,
          ratioX: 1,
          ratioY: 1,
        };
      }
      if (!anchor) return null;
      const target = targets.find((target) => target.id === anchor.targetId);
      const rect = target && rectangles.get(target);
      const live = rect && Number.isFinite(anchor.ratioX) && Number.isFinite(anchor.ratioY);
      return {
        x: live
          ? rect.x + rect.width * anchor.ratioX!
          : anchor.x - (anchor.space === 'document' ? window.scrollX : 0),
        y: live
          ? rect.y + rect.height * anchor.ratioY!
          : anchor.y - (anchor.space === 'document' ? window.scrollY : 0),
        unavailable: targets.some((target) => !rectangles.get(target)),
      };
    }

    const { left, top, width, height } = getViewport();
    let active =
      view.editorOpen && !view.editingId && view.marker ? point(view.marker, view.selected) : null;
    const positions = new Map(
      annotations.map((annotation) => [
        annotation.id,
        point(annotation.marker, annotation.targets, annotation),
      ]),
    );
    for (const button of shadow.querySelectorAll<HTMLButtonElement>('.marker')) {
      const id = button.dataset.annotationId;
      const anchor = id ? positions.get(id) : active;
      button.hidden =
        !anchor ||
        anchor.x < left ||
        anchor.y < top ||
        anchor.x > left + width ||
        anchor.y > top + height;
      if (anchor) {
        button.style.left = `${anchor.x}px`;
        button.style.top = `${anchor.y}px`;
        button.title = anchor.unavailable
          ? m.targetUnavailable
          : id
            ? m.editFeedback
            : m.newAnnotation;
      }
      if (button.hidden && shadow.activeElement === button) button.blur();
    }
    if (view.editingId)
      active =
        positions.get(view.editingId) ?? (view.marker ? point(view.marker, view.selected) : null);
    const popover = shadow.querySelector<HTMLElement>('.popover');
    if (popover) {
      elements.add(popover);
      popover.style.width = `${Math.max(0, Math.min(320, width - 16))}px`;
      popover.style.maxHeight = `${Math.max(0, height - 16)}px`;
      const size = popover.getBoundingClientRect();
      const x = active?.x ?? left + 8;
      const y = active?.y ?? top + 8;
      const preferredX = x + 18 + size.width > left + width - 8 ? x - 18 - size.width : x + 18;
      const preferredY = y + 18 + size.height > top + height - 8 ? y - 18 - size.height : y + 18;
      popover.style.left = `${Math.max(left + 8, Math.min(preferredX, left + width - size.width - 8))}px`;
      popover.style.top = `${Math.max(top + 8, Math.min(preferredY, top + height - size.height - 8))}px`;
    }
    for (const element of observedElements) {
      if (!elements.has(element)) {
        resize.unobserve(element);
        observedElements.delete(element);
      }
    }
    for (const element of elements) {
      if (!observedElements.has(element)) {
        resize.observe(element);
        observedElements.add(element);
      }
    }
    if ([...observedRoots].some((root) => !roots.has(root))) {
      mutations.disconnect();
      observedRoots.clear();
    }
    for (const root of roots) {
      if (!observedRoots.has(root)) {
        mutations.observe(root, {
          subtree: true,
          childList: true,
          attributes: true,
          characterData: true,
        });
        observedRoots.add(root);
      }
    }
  }

  const stop = (event: Event) => event.stopPropagation();
  for (const type of ['click', 'dblclick', 'pointerdown', 'pointerup']) {
    shadow.addEventListener(type, stop, { signal: abort.signal });
  }
  document.addEventListener('scroll', schedule, { capture: true, signal: abort.signal });
  window.addEventListener('resize', schedule, { signal: abort.signal });
  window.visualViewport?.addEventListener('resize', schedule, { signal: abort.signal });
  window.visualViewport?.addEventListener('scroll', schedule, { signal: abort.signal });

  return {
    update(next, nextVisible) {
      if (destroyed) return;
      host.dataset.theme = next.theme;
      host.lang = next.locale;
      const m = messages(next.locale);
      const focused = shadow.activeElement as HTMLElement | null;
      const hadEditorFocus = Boolean(focused?.closest('.popover'));
      const focusedId = focused?.dataset.annotationId;
      const previousEditorId = editorId;
      view = next;
      visible = nextVisible;
      if (!visible) focused?.blur();
      host.style.setProperty('display', visible ? 'block' : 'none', 'important');
      const annotations = next.document?.annotations ?? [];
      const editorTargets = next.editingId
        ? (annotations.find((annotation) => annotation.id === next.editingId)?.targets ??
          next.selected)
        : next.selected;
      const open = next.editorOpen && Boolean(next.editingId || next.marker);
      const key = open
        ? JSON.stringify(next.editingId ?? [next.selected.map((target) => target.id), next.marker])
        : null;
      const focusEditor = visible && key !== null && key !== editorKey;
      const closedEditor = editorKey !== null && key === null;
      editorKey = key;
      editorId = open ? next.editingId : null;
      render(
        html`
          <style>
            ${styles}
          </style>
          <div class=${`layer${next.passthrough ? ' passthrough' : ''}`}>
            ${repeat(
              annotations,
              (annotation) => annotation.id,
              (annotation, index) => html`
                <button
                  class="marker"
                  type="button"
                  data-annotation-id=${annotation.id}
                  aria-label=${m.editAnnotation(index + 1)}
                  @click=${() => onAction({ type: 'edit', id: annotation.id })}
                >
                  <span class="number">${index + 1}</span>
                  <span class="pencil"
                    >${createElement(Pencil, { 'aria-hidden': 'true', focusable: 'false' })}</span
                  >
                </button>
              `,
            )}
            ${
              open && !next.editingId && next.marker
                ? html`
                    <button
                      class="marker"
                      type="button"
                      aria-label=${m.newAnnotation}
                      @click=${() => shadow.querySelector('textarea')?.focus({ preventScroll: true })}
                    >
                      ${createElement(Plus, { 'aria-hidden': 'true', focusable: 'false' })}
                    </button>
                  `
                : nothing
            }
            ${
              open
                ? html`
                    <section
                      class="popover"
                      role="dialog"
                      aria-label=${next.editingId ? m.editFeedback : m.newFeedback}
                      @paste=${(event: ClipboardEvent) => {
                        const file = [...(event.clipboardData?.files ?? [])].find((file) =>
                          file.type.startsWith('image/'),
                        );
                        if (file) {
                          event.preventDefault();
                          event.stopPropagation();
                          onAction({ type: 'import-image', file });
                        }
                      }}
                      @dragover=${(event: DragEvent) => {
                        if (event.dataTransfer?.types.includes('Files')) {
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = 'copy';
                        }
                      }}
                      @drop=${(event: DragEvent) => {
                        if (!event.dataTransfer?.files.length) return;
                        event.preventDefault();
                        event.stopPropagation();
                        const file = event.dataTransfer.files[0];
                        if (file) onAction({ type: 'import-image', file });
                      }}
                      @keydown=${(event: KeyboardEvent) => {
                        if (event.key === 'Escape' && !event.isComposing) {
                          event.preventDefault();
                          event.stopPropagation();
                          onAction({ type: 'cancel-edit' });
                        }
                      }}
                    >
                      <ul class="target-list" aria-label=${m.selectedElements}>
                        ${repeat(
                          editorTargets,
                          (target) => target.id,
                          (target) =>
                            html`<li title=${target.text}>
                              ${target.selector}${target.textSelection ? html`<q class="text-quote" aria-label=${m.selectedText}>${target.textSelection.exact}${target.textSelection.truncated ? '…' : ''}</q>` : nothing}
                            </li>`,
                        )}
                      </ul>
                      <textarea
                        aria-label=${m.feedbackContent}
                        aria-keyshortcuts="Meta+Enter"
                        rows="3"
                        maxlength="10000"
                        .value=${next.draft}
                        ?disabled=${next.storage === 'loading'}
                        @keydown=${(event: KeyboardEvent) => {
                          if (
                            !visible ||
                            event.defaultPrevented ||
                            event.isComposing ||
                            event.key !== 'Enter' ||
                            !event.metaKey ||
                            event.altKey ||
                            event.ctrlKey ||
                            event.shiftKey
                          )
                            return;
                          event.preventDefault();
                          event.stopPropagation();
                          if (!event.repeat)
                            shadow.querySelector<HTMLButtonElement>('.actions .primary')?.click();
                        }}
                        @input=${(event: Event) => onAction({ type: 'draft', value: (event.currentTarget as HTMLTextAreaElement).value })}
                      ></textarea>
                      <div class="images" aria-label=${m.attachedImages}>
                        ${next.images.map(
                          (image, index) => html`<div class="image">
                            <button
                              class="image-preview"
                              type="button"
                              aria-label=${m.editImage(index + 1)}
                              ?disabled=${!next.imageUrls[image.id]}
                              @click=${() => onAction({ type: 'edit-image', id: image.id })}
                            >
                              ${next.imageUrls[image.id] ? html`<img src=${next.imageUrls[image.id]} alt=${m.attachedImage(index + 1)} />` : m.image(index + 1)}
                            </button>
                            <button
                              class="image-action image-download"
                              type="button"
                              aria-label=${m.downloadImageNumber(index + 1)}
                              title=${m.downloadImage}
                              ?disabled=${!next.imageUrls[image.id]}
                              @click=${() => onAction({ type: 'download-image', id: image.id })}
                            >
                              ${createElement(Download, { 'aria-hidden': 'true' })}
                            </button>
                            <button
                              class="image-action image-remove"
                              type="button"
                              aria-label=${m.removeImageNumber(index + 1)}
                              title=${m.removeImage}
                              @click=${() => onAction({ type: 'remove-image', id: image.id })}
                            >
                              ${createElement(Trash2, { 'aria-hidden': 'true' })}
                            </button>
                          </div>`,
                        )}
                      </div>
                      <div class="actions">
                        <button
                          type="button"
                          aria-label=${m.screenshot}
                          title=${m.screenshotHint}
                          ?disabled=${next.saving || next.storage === 'loading' || next.images.length >= 8}
                          @click=${() => onAction({ type: 'screenshot' })}
                        >
                          ${createElement(Camera, { 'aria-hidden': 'true', focusable: 'false' })}
                        </button>
                        <button
                          type="button"
                          aria-label=${m.chooseImage}
                          title=${m.chooseImage}
                          ?disabled=${next.saving || next.storage === 'loading' || next.images.length >= 8}
                          @click=${() => shadow.querySelector<HTMLInputElement>('input[type=file]')?.click()}
                        >
                          ${createElement(ImagePlus, { 'aria-hidden': 'true', focusable: 'false' })}
                        </button>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          hidden
                          @change=${(event: Event) => {
                            const input = event.currentTarget as HTMLInputElement;
                            const file = input.files?.[0];
                            input.value = '';
                            if (file) onAction({ type: 'import-image', file });
                          }}
                        />
                        <div class="actions-end">
                          <button
                            type="button"
                            aria-label=${m.cancel}
                            title=${m.cancel}
                            @click=${() => onAction({ type: 'cancel-edit' })}
                          >
                            ${createElement(X, { 'aria-hidden': 'true', focusable: 'false' })}
                          </button>
                          <button
                            class="primary"
                            type="button"
                            aria-label=${next.editingId ? m.save : m.add}
                            title=${m.shortcut(next.editingId ? m.save : m.add, 'Command/Super + Enter')}
                            aria-keyshortcuts="Meta+Enter"
                            ?disabled=${!next.draft.trim() || next.saving || next.storage === 'loading'}
                            @click=${() => onAction({ type: 'save' })}
                          >
                            ${createElement(Check, { 'aria-hidden': 'true', focusable: 'false' })}
                          </button>
                          ${
                            next.editingId
                              ? html`<button
                                  class="danger"
                                  type="button"
                                  aria-label=${m.delete}
                                  title=${m.delete}
                                  ?disabled=${next.saving}
                                  @click=${() => onAction({ type: 'delete', id: next.editingId! })}
                                >
                                  ${createElement(Trash2, { 'aria-hidden': 'true', focusable: 'false' })}
                                </button>`
                              : nothing
                          }
                        </div>
                      </div>
                      <p class="import-hint">${m.pasteImage}</p>
                      ${next.message ? html`<p class="message" role="status">${next.message}</p>` : nothing}
                    </section>
                  `
                : nothing
            }
          </div>
        `,
        shadow,
      );
      if (visible) {
        position();
        schedule();
        if (focusEditor) {
          const textarea = shadow.querySelector('textarea');
          textarea?.focus({ preventScroll: true });
          textarea?.setSelectionRange(next.draft.length, next.draft.length);
        } else if ((closedEditor && hadEditorFocus) || focusedId) {
          const id = closedEditor
            ? (previousEditorId ??
              annotations.find((annotation) => !annotationIds.has(annotation.id))?.id)
            : focusedId;
          const button = [
            ...shadow.querySelectorAll<HTMLButtonElement>('[data-annotation-id]'),
          ].find((button) => button.dataset.annotationId === id);
          if (button && !button.hidden) button.focus({ preventScroll: true });
        }
      } else {
        cancelAnimationFrame(frame);
        frame = 0;
        resize.disconnect();
        mutations.disconnect();
        observedElements.clear();
        observedRoots.clear();
      }
      annotationIds = new Set(annotations.map((annotation) => annotation.id));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      abort.abort();
      resize.disconnect();
      mutations.disconnect();
      observedElements.clear();
      observedRoots.clear();
      cancelAnimationFrame(frame);
      frame = 0;
      (shadow.activeElement as HTMLElement | null)?.blur();
      render(nothing, shadow);
      host.remove();
      view = null;
      annotationIds.clear();
      editorKey = null;
      editorId = null;
      onAction = () => {};
      getRect = () => null;
    },
  };
}
