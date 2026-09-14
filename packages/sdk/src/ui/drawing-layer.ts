import type { InspectorTheme } from '../core/types';

/** Own the drawing surface's DOM placement and native top-layer lifecycle. */
export function createDrawingLayer(theme: InspectorTheme, signal: AbortSignal) {
  signal.throwIfAborted();
  const host = document.createElement('div');
  host.dataset.ainotationUi = 'drawing';
  host.dataset.theme = theme;
  host.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;width:100%!important;height:100%!important;margin:0!important;border:0!important;padding:0!important;max-width:none!important;max-height:none!important;background:transparent!important;overflow:visible!important;pointer-events:none!important;z-index:2147483647!important;';
  const shadow = host.attachShadow({ mode: 'open' });
  host.popover = 'manual';
  const opened = new WeakMap<HTMLElement, number>();
  let order = 0;

  function surfaces(root: Document | ShadowRoot | HTMLElement, selector: string): HTMLElement[] {
    const found = [...root.querySelectorAll<HTMLElement>(selector)].filter(
      (element) => element !== host,
    );
    for (const element of root.querySelectorAll('*')) {
      if (element !== host && element.shadowRoot)
        found.push(...surfaces(element.shadowRoot, selector));
    }
    return found;
  }
  function raise() {
    if (signal.aborted) return;
    const modal = surfaces(document, 'dialog:modal').at(-1);
    const popover = surfaces(modal ?? document, '[popover]:popover-open')
      .sort((a, b) => (opened.get(a) ?? 0) - (opened.get(b) ?? 0))
      .at(-1);
    const parent = popover ?? modal ?? document.documentElement;
    // Keep the tool operable inside modals and inside native popover dismissal boundaries.
    if (host.parentElement !== parent) {
      if (host.matches(':popover-open')) host.hidePopover();
      parent.append(host);
    }
    if (host.showPopover && !host.matches(':popover-open')) host.showPopover();
  }
  const mutations = new MutationObserver((records) => {
    if (!host.isConnected || records.some((record) => record.type === 'attributes')) raise();
  });
  try {
    raise();
    signal.throwIfAborted();
    mutations.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });
  } catch (error) {
    host.remove();
    mutations.disconnect();
    throw error;
  }
  window.addEventListener(
    'beforetoggle',
    (event) => {
      const element = event.composedPath()[0];
      if (!(element instanceof HTMLElement) || element === host || !element.hasAttribute('popover'))
        return;
      if ((event as ToggleEvent).newState === 'open') opened.set(element, ++order);
      queueMicrotask(raise);
    },
    { capture: true, signal },
  );
  signal.addEventListener(
    'abort',
    () => {
      mutations.disconnect();
      host.remove();
    },
    { once: true },
  );
  return { host, shadow, raise };
}
