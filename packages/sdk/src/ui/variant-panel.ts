import { css, html, nothing } from 'lit';
import { variantActive, variantAnnotations } from '@ainotation/schema';
import { ChevronDown, ChevronLeft, ChevronRight, Minus, createElement } from 'lucide';
import type { InspectorAction, InspectorViewState } from '../core/types';
import { messages } from '../i18n';

export const variantPanelStyles = css`
  .variants-mode {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin: 8px 0;
  }
  .variants-mode button[aria-checked='true'] {
    background: var(--ain-accent);
    color: var(--ain-on-accent);
    border-color: var(--ain-accent);
  }
  .variants-mode .variant-switch {
    position: relative;
    width: 32px;
    height: 20px;
    padding: 0;
    border-radius: 12px;
    background: var(--ain-field);
  }
  .variant-switch::after {
    content: '';
    position: absolute;
    top: 3px;
    left: 3px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--ain-muted);
  }
  .variant-switch[aria-checked='true']::after {
    transform: translateX(12px);
    background: var(--ain-on-accent);
  }
  .variants-hint {
    margin: 6px 0;
    color: var(--ain-muted);
    font-size: 11px;
  }
  .variants-controller {
    position: fixed;
    left: 50%;
    bottom: 16px;
    transform: translateX(-50%);
    width: min(480px, calc(100vw - 32px));
    max-height: calc(100dvh - 100px);
    overflow: auto;
    overscroll-behavior: contain;
    padding: 12px;
    border: 1px solid var(--ain-border);
    border-radius: 8px;
    background: var(--ain-surface);
    box-shadow: 0 4px 20px var(--ain-shadow);
    pointer-events: auto;
    cursor: grab;
  }
  .variants-controller.dragging,
  .variants-controller.dragging * {
    cursor: grabbing !important;
    user-select: none;
  }
  .variants-controller:focus-visible {
    outline: 2px solid var(--ain-focus);
    outline-offset: 2px;
  }
  .variants-heading {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    align-items: center;
  }
  .variants-actions {
    display: flex;
    justify-content: center;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }
  .variants-actions button {
    padding: 5px 7px;
    white-space: nowrap;
  }
  .variants-actions .danger,
  .variant-confirm-actions .danger {
    color: var(--ain-error);
    border-color: var(--ain-error);
    background: var(--ain-error-surface);
  }
  .variants-actions .danger:hover:not(:disabled),
  .variant-confirm-actions .danger:hover:not(:disabled) {
    box-shadow: inset 0 0 0 1px var(--ain-error);
  }
  .variant-confirm {
    width: min(360px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    margin: auto;
    padding: 20px;
    overflow: auto;
    border: 1px solid var(--ain-border);
    border-radius: 8px;
    background: var(--ain-surface);
    color: var(--ain-text);
    box-shadow: 0 4px 20px var(--ain-shadow);
    pointer-events: auto;
  }
  .variant-confirm::backdrop {
    background: var(--ain-crop-shade);
    pointer-events: auto;
  }
  .variant-confirm h2 {
    margin: 0;
    font-size: 15px;
  }
  .variant-confirm p {
    margin: 10px 0 20px;
    color: var(--ain-muted);
  }
  .variant-confirm-actions {
    display: flex;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 8px;
  }
  .variants-heading-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .variants-heading .variant-heading-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 5px;
    border-color: transparent;
    background: transparent;
    color: var(--ain-muted);
  }
  .variants-heading .variant-heading-button:hover:not(:disabled) {
    color: var(--ain-text);
  }
  .variant-heading-button svg {
    width: 16px;
    height: 16px;
  }
  .variants-navigation {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-top: 10px;
  }
  .variant-step {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 48px;
    width: 48px;
    height: 32px;
    padding: 6px;
  }
  .variant-step svg {
    width: 16px;
    height: 16px;
  }
  .variant-current {
    flex: 1;
    min-width: 0;
    text-align: center;
  }
  .variant-name {
    display: block;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .variant-page {
    display: block;
    color: var(--ain-muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .variants-controller p {
    margin: 8px 0;
  }
  .variants-controller details {
    margin-top: 10px;
  }
  .variants-controller summary {
    cursor: pointer;
    color: var(--ain-muted);
    font-size: 12px;
  }
  .variants-controller textarea {
    width: 100%;
    margin-top: 8px;
    padding: 8px;
    border: 1px solid var(--ain-border);
    border-radius: 4px;
    background: var(--ain-field);
    color: var(--ain-text);
    resize: vertical;
    min-height: 64px;
    cursor: text;
  }
  .passthrough .variants-controller,
  .passthrough .variants-controller * {
    pointer-events: none !important;
  }
`;

export function variantToggle(view: InspectorViewState) {
  if (view.localOnly) return nothing;
  const m = messages(view.locale);
  const existing = view.document?.annotations.find(
    (annotation) => annotation.id === view.editingId,
  )?.variants;
  const busy =
    view.document &&
    variantAnnotations(view.document).some(
      (annotation) => annotation.id !== view.editingId && variantActive(annotation.variants),
    );
  const connected = view.connection === 'connected' && view.variantsSupported;
  const active = variantActive(existing);
  return html`<div class="variants-mode">
      <span>${m.variantsTitle}</span
      ><button
        type="button"
        class="variant-switch"
        role="switch"
        aria-label=${m.variantsTitle}
        aria-checked=${active || view.variantsRequested ? 'true' : 'false'}
        data-action="variants-toggle"
        ?disabled=${active || view.saving || (!view.variantsRequested && (!connected || busy))}
      ></button>
    </div>
    <p class="variants-hint">
      ${existing?.status === 'accepted' ? m.variantsAccepted : existing?.status === 'cancelled' ? m.variantsCancelled : busy ? m.variantsBusy : !connected && !active ? (view.connection === 'connected' ? m.variantsUnsupported : m.variantsNeedsConnection) : m.variantsHint}
    </p>`;
}

export function variantController(view: InspectorViewState) {
  if (view.localOnly) return nothing;
  const annotation =
    view.document &&
    variantAnnotations(view.document).find((item) => item.id === view.variantAnnotationId);
  const exploration = annotation?.variants;
  const deleted = !!annotation && 'deletedAt' in annotation;
  if (
    !exploration ||
    (exploration.status === 'completed' &&
      view.variantPreview.problem !== 'cleanup' &&
      !view.variantConflict)
  )
    return nothing;
  const m = messages(view.locale);
  const status =
    view.variantPreview.problem === 'cleanup'
      ? m.variantsCleanup
      : exploration.status === 'completed'
        ? m.variantsCompleted
        : exploration.status === 'accepted'
          ? m.variantsAccepted
          : exploration.status === 'cancelled'
            ? deleted
              ? m.variantsDeleted
              : m.variantsCancelled
            : exploration.status === 'requested'
              ? m.variantsRequested
              : view.variantPreview.status === 'ready'
                ? null
                : view.variantPreview.status === 'switching'
                  ? m.variantsSwitching
                  : view.variantPreview.status === 'error'
                    ? m.variantsBindingError
                    : m.variantsWaiting;
  const decide = ['published', 'accepted'].includes(exploration.status);
  const choices = [
    { id: 'original', label: m.variantsOriginal, description: '' },
    ...(exploration.manifest?.choices ?? []),
  ];
  const index = Math.max(
    0,
    choices.findIndex((choice) => choice.id === view.variantPreview.variantId),
  );
  const current = choices[index]!;
  const canNavigate =
    ['requested', 'published'].includes(exploration.status) && !view.variantSaving;
  const canDecide = exploration.status !== 'completed' && exploration.status !== 'cancelled';
  const round = `${m.variantsGeneration} ${exploration.manifest?.generation ?? exploration.generation}`;
  return html`<section
    class="variants-controller"
    role="region"
    tabindex="0"
    aria-label=${m.variantsTitle}
    aria-description=${m.styleMovePanel}
    aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
  >
    <div class="variants-heading">
      <strong>${m.variantsTitle}</strong>
      <div class="variants-heading-actions">
        <button
          type="button"
          class="variant-heading-button"
          data-action="variant-minimize"
          aria-label=${view.variantMinimized ? m.variantsExpand : m.variantsMinimize}
          title=${view.variantMinimized ? m.variantsExpand : m.variantsMinimize}
          aria-expanded=${view.variantMinimized ? 'false' : 'true'}
          aria-controls="ain-variants-content"
        >
          ${createElement(view.variantMinimized ? ChevronDown : Minus, { 'aria-hidden': 'true', focusable: 'false' })}
        </button>
      </div>
    </div>
    <div id="ain-variants-content" ?hidden=${view.variantMinimized}>
      ${status ? html`<p role="status">${status}</p>` : nothing}
      ${view.connection !== 'connected' || view.syncing ? html`<p class="variants-hint">${m.variantsSyncPending}</p>` : nothing}
      ${view.variantConflict ? html`<p role="alert">${m.variantsConflict}</p>` : nothing}
      ${
        exploration.manifest
          ? html`<div class="variants-navigation" role="group" aria-label=${m.variantsTitle}>
              <button
                type="button"
                class="variant-step"
                data-variant-step="previous"
                data-variant-id=${choices[(index - 1 + choices.length) % choices.length]!.id}
                aria-label=${m.variantsPrevious}
                title=${m.variantsPrevious}
                ?disabled=${!canNavigate}
              >
                ${createElement(ChevronLeft, { 'aria-hidden': 'true', focusable: 'false' })}
              </button>
              <div
                class="variant-current"
                data-current-variant=${current.id}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                <span class="variant-name" title=${current.description || current.label}
                  >${current.label}</span
                >
                <span
                  class="variant-page"
                  aria-label=${`${round}, ${m.variantsPage} ${index + 1}/${choices.length}`}
                  >${round} · ${index + 1}/${choices.length}</span
                >
              </div>
              <button
                type="button"
                class="variant-step"
                data-variant-step="next"
                data-variant-id=${choices[(index + 1) % choices.length]!.id}
                aria-label=${m.variantsNext}
                title=${m.variantsNext}
                ?disabled=${!canNavigate}
              >
                ${createElement(ChevronRight, { 'aria-hidden': 'true', focusable: 'false' })}
              </button>
            </div>`
          : nothing
      }
      ${
        canDecide
          ? html` <details>
              <summary>${m.variantsFeedback}</summary>
              <textarea
                data-variant-feedback
                aria-label=${m.variantsFeedback}
                maxlength="10000"
                rows="2"
                .value=${view.variantFeedback}
                ?disabled=${view.variantSaving}
              ></textarea>
            </details>`
          : nothing
      }
      <div class="variants-actions">
        ${
          canDecide
            ? html`
                <button
                  type="button"
                  class="primary"
                  data-variant-decision="accept"
                  ?disabled=${exploration.status !== 'published' || view.variantPreview.status !== 'ready' || view.variantPreview.generation !== exploration.generation || view.variantSaving}
                >
                  ${m.variantsAccept}
                </button>
                <button
                  type="button"
                  data-variant-decision="regenerate"
                  ?disabled=${!decide || view.variantSaving}
                >
                  ${m.variantsRegenerate}
                </button>
              `
            : nothing
        }
        ${
          !deleted
            ? html`<button type="button" data-action="variant-open" title=${m.variantsOpen}>
                ${m.variantsOpen}
              </button>`
            : nothing
        }
        ${canDecide ? html`<button type="button" class="danger" data-action="variant-cancel" aria-haspopup="dialog" ?disabled=${view.variantSaving}>${m.variantsCancel}</button>` : nothing}
      </div>
    </div>
  </section>`;
}

export function handleVariantControl(
  event: Event,
  target: Element,
  view: InspectorViewState,
  send: (action: InspectorAction) => void,
) {
  if (!target.closest('.variants-controller')) return false;
  if (event.type === 'input' && target instanceof HTMLTextAreaElement)
    send({ type: 'variant-feedback', value: target.value });
  if (event.type === 'click') {
    const button = target.closest<HTMLButtonElement>('button');
    if (button && !button.disabled) {
      if (button.dataset.variantId)
        send({ type: 'variant-preview', value: button.dataset.variantId });
      else if (button.dataset.variantDecision)
        send({
          type: 'variant-decision',
          decision: button.dataset.variantDecision as 'accept' | 'regenerate' | 'cancel',
        });
      else if (button.dataset.action === 'variant-minimize') {
        send({ type: 'variant-minimized', value: !view.variantMinimized });
        button.focus({ preventScroll: true });
      } else if (button.dataset.action === 'variant-open')
        send({ type: 'edit', id: view.variantAnnotationId });
    }
  }
  return true;
}
