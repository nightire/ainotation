import { html } from 'lit';
import type { InspectorAction, InspectorViewState } from '../core/types';
import { messages } from '../i18n';

/** Presentation-only confirmation, scoped to the exact exploration being reviewed. */
export function createVariantConfirmation(
  root: ShadowRoot,
  send: (action: InspectorAction) => void,
) {
  let currentKey: string | null = null;
  let requestedKey: string | null = null;
  let trigger: HTMLButtonElement | null = null;
  const dialog = () => root.querySelector<HTMLDialogElement>('.variant-confirm');
  function dismiss() {
    requestedKey = null;
    dialog()?.close();
    if (trigger?.isConnected && !trigger.disabled && trigger.checkVisibility())
      trigger.focus({ preventScroll: true });
    trigger = null;
  }
  return {
    template(view: InspectorViewState) {
      const m = messages(view.locale);
      return html`<dialog
        class="variant-confirm"
        role="alertdialog"
        aria-labelledby="ain-variant-confirm-title"
        aria-describedby="ain-variant-confirm-description"
        @cancel=${(event: Event) => {
          event.preventDefault();
          dismiss();
        }}
      >
        <h2 id="ain-variant-confirm-title">${m.variantsCancelTitle}</h2>
        <p id="ain-variant-confirm-description">${m.variantsCancelDescription}</p>
        <div class="variant-confirm-actions">
          <button type="button" data-action="variant-keep" autofocus>
            ${m.variantsKeepComparing}
          </button>
          <button type="button" class="danger" data-action="variant-confirm-cancel">
            ${m.variantsCancel}
          </button>
        </div>
      </dialog>`;
    },
    update(view: InspectorViewState, visible: boolean) {
      const annotation = view.document?.annotations.find(
        (item) => item.id === view.variantAnnotationId,
      );
      const exploration = annotation?.variants;
      currentKey =
        visible &&
        !view.localOnly &&
        !view.passthrough &&
        !view.variantMinimized &&
        !view.variantSaving &&
        exploration &&
        !['completed', 'cancelled'].includes(exploration.status)
          ? JSON.stringify([
              view.document?.id,
              view.document?.url,
              annotation?.id,
              exploration.id,
              exploration.generation,
              exploration.revision,
            ])
          : null;
      if (requestedKey !== null && requestedKey !== currentKey) dismiss();
    },
    handle(event: Event, target: Element) {
      const button = target.closest<HTMLButtonElement>('button');
      if (target.closest('.variant-confirm')) {
        if (event.type === 'keydown' && event instanceof KeyboardEvent && event.key === 'Escape') {
          event.preventDefault();
          dismiss();
        } else if (event.type === 'click' && button && !button.disabled) {
          if (button.dataset.action === 'variant-keep') dismiss();
          else if (button.dataset.action === 'variant-confirm-cancel') {
            const confirmed =
              dialog()?.open && requestedKey !== null && requestedKey === currentKey;
            dismiss();
            if (confirmed) send({ type: 'variant-decision', decision: 'cancel' });
          }
        }
        return true;
      }
      if (button?.dataset.action !== 'variant-cancel' || !button.closest('.variants-controller'))
        return false;
      if (event.type === 'click' && !button.disabled && currentKey !== null) {
        trigger = button;
        requestedKey = currentKey;
        button.focus({ preventScroll: true });
        dialog()?.showModal();
      }
      return true;
    },
    destroy: dismiss,
  };
}
