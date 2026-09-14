type DrawingPointerEvent = 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel';

/** Route original events before host outside-click handlers, without synthesizing clicks. */
export function bindDrawingPointerEvents(options: {
  root: ShadowRoot;
  signal: AbortSignal;
  passthrough: () => boolean;
  hover: (target: HTMLElement | null) => void;
  activate: (button: HTMLButtonElement, keyboard: boolean) => void;
  draw: (
    type: DrawingPointerEvent,
    event: PointerEvent,
    target: Element,
    surface: SVGSVGElement,
  ) => void;
}) {
  const { root, signal } = options;
  const own = (node: EventTarget): node is Element =>
    node instanceof Element && node.getRootNode() === root;
  for (const type of [
    'pointerover',
    'pointerout',
    'mouseover',
    'mouseout',
    'pointerdown',
    'pointermove',
    'pointerup',
    'pointercancel',
    'mousedown',
    'mousemove',
    'mouseup',
    'click',
    'dblclick',
    'contextmenu',
    'touchstart',
    'touchmove',
    'touchend',
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (options.passthrough() || (event instanceof MouseEvent && event.altKey)) return;
        const path = event.composedPath();
        const toolbar = path.find(
          (node) =>
            own(node) && (node.classList.contains('toolbar') || node.classList.contains('palette')),
        );
        if (toolbar) {
          // Pointer defaults would focus controls and dismiss the host's menu.
          // Touch activation still needs its eventual click to reach this router.
          if (!type.startsWith('touch')) event.preventDefault();
          event.stopImmediatePropagation();
          const button = path.find((node) => own(node) && node instanceof HTMLButtonElement);
          if (type === 'pointermove' || type === 'pointerover')
            options.hover(button instanceof HTMLButtonElement ? button : null);
          else if (type === 'pointerout') {
            const related = (event as PointerEvent).relatedTarget;
            options.hover(
              related && own(related) ? related.closest<HTMLElement>('[data-tooltip]') : null,
            );
          } else if (type === 'pointerdown') options.hover(null);
          else if (type === 'click' && button instanceof HTMLButtonElement)
            options.activate(button, event instanceof MouseEvent && event.detail === 0);
          return;
        }
        const surface = path.find(
          (node) =>
            own(node) &&
            node instanceof SVGSVGElement &&
            node.classList.contains('drawing-surface'),
        );
        if (!(surface instanceof SVGSVGElement)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (
          event instanceof PointerEvent &&
          ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].includes(type)
        )
          options.draw(
            type as DrawingPointerEvent,
            event,
            path[0] instanceof Element ? path[0] : surface,
            surface,
          );
      },
      { capture: true, passive: false, signal },
    );
  }
}
