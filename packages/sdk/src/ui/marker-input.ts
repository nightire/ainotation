/** Isolate the marker/editor before document capture handlers can dismiss host menus.
 * Route the original event to our controls; retain native text editing and file picking.
 */
export function bindMarkerEvents(options: {
  root: ShadowRoot;
  signal: AbortSignal;
  active: () => boolean;
  passthrough: () => boolean;
  handle: (event: Event, target: Element) => void;
}) {
  const { root, signal } = options;
  const own = (target: EventTarget | null): target is Element =>
    target instanceof Element && (target === root.host || target.getRootNode() === root);
  const leaving = new Set([
    'blur',
    'focusout',
    'pointerout',
    'pointerleave',
    'mouseout',
    'mouseleave',
  ]);
  const buttonDefaults = new Set([
    'pointerdown',
    'pointerup',
    'mousedown',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
  ]);
  const route = (event: Event) => {
    if (!options.active() || options.passthrough()) return;
    if ((event instanceof MouseEvent || event instanceof KeyboardEvent) && event.altKey) return;
    // Selection owns the Alt latch, including releasing it while focus is in the editor.
    if (
      event instanceof KeyboardEvent &&
      (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight')
    )
      return;
    const target = event.composedPath().find(own);
    const entering =
      leaving.has(event.type) &&
      (event instanceof MouseEvent || event instanceof FocusEvent) &&
      own(event.relatedTarget);
    if (!target && !entering) return;
    event.stopImmediatePropagation();
    if (!target) return;
    const button = target.closest('button');
    if (button && buttonDefaults.has(event.type)) event.preventDefault();
    options.handle(event, target);
  };
  for (const type of [
    'pointerdown',
    'pointerup',
    'pointermove',
    'pointercancel',
    'pointerover',
    'pointerout',
    'pointerenter',
    'pointerleave',
    'mousedown',
    'mouseup',
    'mousemove',
    'mouseover',
    'mouseout',
    'mouseenter',
    'mouseleave',
    'click',
    'dblclick',
    'contextmenu',
    'touchstart',
    'touchmove',
    'touchend',
    'touchcancel',
    'focus',
    'blur',
    'focusin',
    'focusout',
    'keydown',
    'keyup',
    'keypress',
    'beforeinput',
    'input',
    'change',
    'compositionstart',
    'compositionupdate',
    'compositionend',
    'copy',
    'cut',
    'paste',
    'dragstart',
    'dragenter',
    'dragover',
    'dragleave',
    'drop',
    'dragend',
    'wheel',
  ]) {
    window.addEventListener(type, route, { capture: true, passive: false, signal });
    // Non-composed events (notably file-input change) stay inside the shadow root.
    root.addEventListener(type, route, { capture: true, passive: false, signal });
  }
}
