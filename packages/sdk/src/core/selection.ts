import type { MarkerAnchor, PageSnapshot, TargetSnapshot } from '@ainotation/schema';
import { parentElement, excludedElement, hitTest } from './dom';
import { createDomObserver } from './dom-observer';
import { captureAttributes, captureDomContext } from './dom-context';
import { selectorFor } from './selector';
import { captureTextRange, rangeBetween, textCaretAt, type TextCaret } from './text-selection';

type Availability = 'available' | 'missing' | 'ambiguous';
type Options = {
  visible?: boolean;
  appearance?: { theme: string; cssText: string };
  exclude?: (element: Element) => boolean;
  onChange: () => void;
  onPickingChange?: (picking: boolean) => void;
  onPassthroughChange?: (active: boolean) => void;
  onSelect?: (anchor: MarkerAnchor, targets: TargetSnapshot[]) => void;
  onBatchChange?: (active: boolean) => void;
  onCancel?: () => void;
};

const fingerprintAttributes = ['id', 'data-testid', 'aria-label', 'role'];
const styleProperties = [
  'display',
  'position',
  'color',
  'background-color',
  'font-size',
  'font-weight',
  'padding',
  'margin',
  'width',
  'height',
  'transform',
  'border',
  'outline',
  'box-shadow',
  'border-color',
  'border-radius',
  'font-family',
  'line-height',
  'letter-spacing',
  'text-align',
  'top',
  'right',
  'bottom',
  'left',
  'z-index',
  'flex-direction',
  'justify-content',
  'align-items',
  'gap',
  'opacity',
  'visibility',
  'overflow',
];

function query(root: Document | ShadowRoot, selector: string): Element[] {
  try {
    return Array.from(root.querySelectorAll(selector));
  } catch {
    return [];
  }
}

function visibleText(element: Element, excluded: (element: Element) => boolean): string {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let text = '';
  let visited = 0;
  for (let node = walker.nextNode(); node && visited++ < 4096; node = walker.nextNode()) {
    let visible = true;
    for (
      let ancestor: Element | null = node.parentElement;
      ancestor;
      ancestor = parentElement(ancestor)
    ) {
      if (
        excluded(ancestor) ||
        /^(script|style|textarea|input|noscript)$/i.test(ancestor.localName)
      ) {
        visible = false;
        break;
      }
      const style = getComputedStyle(ancestor);
      if (
        style.display === 'none' ||
        style.opacity === '0' ||
        style.visibility === 'hidden' ||
        style.visibility === 'collapse'
      ) {
        visible = false;
        break;
      }
    }
    if (visible) text = `${text} ${node.textContent ?? ''}`.replace(/\s+/g, ' ').trimStart();
    if (text.length >= 500) break;
  }
  return text.trim().slice(0, 500);
}

function geometry(element: Element): Pick<TargetSnapshot, 'rect' | 'styles'> {
  const { x, y, width, height } = element.getBoundingClientRect();
  const computed = getComputedStyle(element);
  return {
    rect: { x, y, width, height },
    styles: Object.fromEntries(
      styleProperties.map((property) => [
        property,
        computed.getPropertyValue(property).slice(0, 1000),
      ]),
    ),
  };
}

export function capturePage(): PageSnapshot {
  return {
    url: location.href.slice(0, 8000),
    title: document.title.slice(0, 1000),
    userAgent: navigator.userAgent.slice(0, 1000),
    capturedAt: new Date().toISOString(),
    viewport: {
      width: Math.max(1, window.innerWidth || document.documentElement.clientWidth),
      height: Math.max(1, window.innerHeight || document.documentElement.clientHeight),
      devicePixelRatio: window.devicePixelRatio > 0 ? window.devicePixelRatio : 1,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
    },
  };
}

export function createSelection(options: Options) {
  let visible = options.visible ?? true;
  let targets: TargetSnapshot[] = [];
  let elementIds = new WeakMap<Element, string>();
  // Keep identity tombstones even after a weak reference is collected or detached.
  const references = new Map<string, WeakRef<Element>>();
  const ancestryHistory = new Map<string, TargetSnapshot[]>();
  const watched = new Map<string, { target: TargetSnapshot; status: Availability }>();
  let picking = false;
  let passthrough = false;
  let passedGesture = false;
  let interactionKeys: AbortController | undefined;
  let shiftHeld = false;
  let pointerPosition: { x: number; y: number } | null = null;
  let press: {
    element: Element;
    pointerId: number;
    x: number;
    y: number;
    caret: TextCaret | null;
  } | null = null;
  let textRange: Range | null = null;
  let cancelledPointer: number | null = null;
  let handledRelease: { pointerId: number; x: number; y: number; time: number } | null = null;
  let batchActive = false;
  let destroyed = false;
  let hover: Element | null = null;
  let frame = 0;
  const abort = new AbortController();
  const excluded = (element: Element) => excludedElement(element, options.exclude);
  const usable = (element: Element) =>
    element.isConnected && element.ownerDocument === document && !excluded(element);
  const overlay = document.createElement('div');
  overlay.setAttribute('data-ainotation-ui', 'selection');
  overlay.dataset.theme = options.appearance?.theme ?? 'light';
  overlay.style.cssText =
    'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483646!important;';
  if (!visible) overlay.style.setProperty('display', 'none', 'important');
  const overlayRoot = overlay.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${options.appearance?.cssText ?? ''}:host{pointer-events:none}.rect{position:fixed;box-sizing:border-box;border:2px solid var(--ain-guide-focus, #00665a);background:var(--ain-guide-fill, transparent);pointer-events:none}.hover{border-style:dashed}`;
  const drawing = document.createElement('div');
  overlayRoot.append(style, drawing);
  (document.body ?? document.documentElement).append(overlay);

  function resolve(target: TargetSnapshot): { status: Availability; element?: Element } {
    if (destroyed) return { status: 'missing' };
    const known = references.get(target.id);
    if (known) {
      const element = known.deref();
      return element && usable(element) ? { status: 'available', element } : { status: 'missing' };
    }
    let root: Document | ShadowRoot = document;
    for (const selector of target.shadowHosts) {
      const hosts = query(root, selector);
      if (hosts.length > 1) return { status: 'ambiguous' };
      const host = hosts[0];
      if (!host || excluded(host) || !host.shadowRoot) return { status: 'missing' };
      root = host.shadowRoot;
    }
    const candidates = query(root, target.selector);
    if (candidates.length > 1) return { status: 'ambiguous' };
    const element = candidates[0];
    if (
      !element ||
      !usable(element) ||
      element.localName !== target.tagName ||
      (target.tagName === 'img' &&
        ['src', 'alt'].some(
          (name) =>
            Object.hasOwn(target.attributes, name) &&
            element.getAttribute(name) !== target.attributes[name],
        )) ||
      visibleText(element, excluded) !== target.text ||
      fingerprintAttributes.some(
        (name) =>
          (element.getAttribute(name)?.slice(0, 1000) ?? undefined) !== target.attributes[name],
      )
    )
      return { status: 'missing' };
    references.set(target.id, new WeakRef(element));
    if (!elementIds.has(element)) elementIds.set(element, target.id);
    return { status: 'available', element };
  }

  function availability(target: TargetSnapshot): Availability {
    const status = resolve(target).status;
    if (!destroyed) watched.set(target.id, { target: structuredClone(target), status });
    return status;
  }

  function getRect(target: TargetSnapshot): TargetSnapshot['rect'] | null {
    const { element } = resolve(target);
    if (!element) return null;
    const { x, y, width, height } = element.getBoundingClientRect();
    return { x, y, width, height };
  }

  function anchorFor(target: TargetSnapshot, point?: { x: number; y: number }): MarkerAnchor {
    const { element } = resolve(target);
    const rect = element?.getBoundingClientRect() ?? target.rect;
    let fixed = element ? false : target.styles.position === 'fixed';
    for (let current = element; current; current = parentElement(current) ?? undefined) {
      if (getComputedStyle(current).position === 'fixed') {
        fixed = true;
        break;
      }
    }
    const { scrollX, scrollY } = capturePage().viewport;
    const x = point?.x ?? rect.x + rect.width;
    const y = point?.y ?? rect.y + rect.height;
    return {
      x: x + (fixed ? 0 : scrollX),
      y: y + (fixed ? 0 : scrollY),
      space: fixed ? 'viewport' : 'document',
      targetId: target.id,
      ratioX: point && rect.width ? (x - rect.x) / rect.width : 1,
      ratioY: point && rect.height ? (y - rect.y) / rect.height : 1,
    };
  }

  function getTargets(): TargetSnapshot[] {
    targets = targets.map((target) => {
      const { element } = resolve(target);
      return element ? { ...target, ...geometry(element) } : target;
    });
    return structuredClone(targets);
  }

  function commit(point?: { x: number; y: number }, targetId?: string) {
    const selected = getTargets();
    const target = selected.find((item) => item.id === targetId) ?? selected.at(-1);
    if (target) options.onSelect?.(anchorFor(target, point), selected);
  }

  function targetAtPointer(): TargetSnapshot | undefined {
    if (!pointerPosition) return;
    const { x, y } = pointerPosition;
    const { element: hit } = hitTest(x, y);
    if (!hit || excluded(hit)) return;
    return [...targets].reverse().find((target) => {
      const { element } = resolve(target);
      if (!element) return false;
      const rect = element.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return false;
      for (let node: Element | null = hit; node; node = parentElement(node)) {
        if (node === element) return true;
      }
      return false;
    });
  }

  function endBatch(commitSelection = true) {
    shiftHeld = false;
    if (!batchActive) return;
    batchActive = false;
    options.onBatchChange?.(false);
    if (commitSelection) {
      const target = targetAtPointer();
      commit(target ? (pointerPosition ?? undefined) : undefined, target?.id);
    }
  }

  function draw() {
    frame = 0;
    if (destroyed || !visible) return;
    let changed = false;
    for (const entry of watched.values()) {
      const status = resolve(entry.target).status;
      if (status !== entry.status) {
        entry.status = status;
        changed = true;
      }
    }
    const rectangles: HTMLElement[] = [];
    const add = (element: Element, hovered = false) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      const rectangle = document.createElement('div');
      rectangle.className = hovered ? 'rect hover' : 'rect';
      rectangle.style.cssText = `left:${x}px;top:${y}px;width:${width}px;height:${height}px`;
      rectangles.push(rectangle);
    };
    if (!passthrough) {
      targets.forEach((target) => {
        const { element } = resolve(target);
        if (element) add(element);
      });
      if (picking && hover && usable(hover)) add(hover, true);
    }
    drawing.replaceChildren(...rectangles);
    if (changed) {
      observeSizes();
      options.onChange();
    }
  }

  function schedule() {
    if (!destroyed && visible && !frame) frame = requestAnimationFrame(draw);
  }

  const resize = new ResizeObserver(schedule);
  const observer = createDomObserver({
    onChange: schedule,
    ...(options.exclude ? { exclude: options.exclude } : {}),
  });

  function observeRoots() {
    if (visible) observer.refresh();
    else observer.disconnect();
  }

  function observeSizes() {
    resize.disconnect();
    if (!visible) return;
    for (const target of targets) {
      const { element } = resolve(target);
      if (element) resize.observe(element);
    }
    if (hover && usable(hover)) resize.observe(hover);
  }

  function changed() {
    for (const target of targets) availability(target);
    observeRoots();
    observeSizes();
    schedule();
    options.onChange();
  }

  function snapshot(element: Element): TargetSnapshot {
    let root = element.getRootNode();
    if (!(root instanceof Document || root instanceof ShadowRoot))
      throw new Error('Target must be connected to the document.');
    const selector = selectorFor(element, root);
    const shadowHosts: string[] = [];
    while (root instanceof ShadowRoot) {
      if (root.mode !== 'open')
        throw new Error('Targets inside closed shadow roots are unavailable.');
      const host = root.host;
      root = host.getRootNode();
      if (!(root instanceof Document || root instanceof ShadowRoot))
        throw new Error('Target must be connected to the document.');
      shadowHosts.unshift(selectorFor(host, root));
    }
    if (shadowHosts.length > 20)
      throw new Error('Target exceeds the shadow root depth limit of 20.');
    const id = elementIds.get(element) ?? crypto.randomUUID();
    const target: TargetSnapshot = {
      id,
      selector,
      shadowHosts,
      tagName: element.localName.slice(0, 100),
      text: visibleText(element, excluded),
      attributes: captureAttributes(element),
      ...captureDomContext(element, excluded, (node) => visibleText(node, excluded)),
      ...geometry(element),
      states: { focused: element.matches(':focus'), focusWithin: element.matches(':focus-within') },
    };
    elementIds.set(element, id);
    references.set(id, new WeakRef(element));
    return target;
  }

  function checkLimit(count: number) {
    // Matches AnnotationSchema.targets; the browser test checks this boundary.
    const limit = 20;
    if (count > limit) throw new Error(`Select at most ${limit} targets.`);
  }

  function select(element: Element, additive = false) {
    if (destroyed || !usable(element)) return;
    ancestryHistory.clear();
    const existing = targets.findIndex((target) => references.get(target.id)?.deref() === element);
    if (additive && existing >= 0) {
      targets.splice(existing, 1);
    } else {
      if (!additive && existing === 0 && targets.length === 1) return;
      checkLimit(additive ? targets.length + 1 : 1);
      const target = snapshot(element);
      targets = additive ? [...targets, target] : [target];
    }
    changed();
  }

  function setTargets(value: TargetSnapshot[]) {
    if (destroyed) return;
    checkLimit(value.length);
    const next = structuredClone(value);
    if (JSON.stringify(next) === JSON.stringify(targets)) return;
    ancestryHistory.clear();
    endBatch(false);
    targets = next;
    changed();
  }

  function setPicking(value: boolean) {
    value = visible && value;
    if (destroyed || picking === value) return;
    if (!value) endBatch(!passthrough);
    if (!value) {
      clearTextRange();
      cancelledPointer = null;
      press = null;
      handledRelease = null;
    }
    picking = value;
    interactionKeys?.abort();
    interactionKeys = undefined;
    passedGesture = false;
    setPassthrough(false);
    if (picking) {
      interactionKeys = new AbortController();
      const signal = interactionKeys.signal;
      document.addEventListener(
        'keydown',
        (event) => {
          if (event.isComposing) return;
          if (event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight')
            setPassthrough(event.altKey);
        },
        { capture: true, signal },
      );
      window.addEventListener(
        'keyup',
        (event) => {
          if (
            event.key === 'Alt' ||
            event.code === 'AltLeft' ||
            event.code === 'AltRight' ||
            !event.altKey
          )
            setPassthrough(event.altKey);
        },
        { capture: true, signal },
      );
      window.addEventListener(
        'blur',
        () => {
          passedGesture = false;
          setPassthrough(false);
        },
        { signal },
      );
      document.addEventListener(
        'visibilitychange',
        () => {
          if (document.visibilityState === 'hidden') {
            passedGesture = false;
            setPassthrough(false);
          }
        },
        { signal },
      );
    }
    hover = null;
    observeSizes();
    schedule();
    options.onPickingChange?.(value);
  }

  function setPassthrough(value: boolean) {
    value = picking && visible && value;
    if (passthrough === value || destroyed) return;
    passthrough = value;
    clearTextRange();
    if (value && press) passedGesture = true;
    press = null;
    handledRelease = null;
    hover = null;
    if (value) drawing.replaceChildren();
    schedule();
    options.onPassthroughChange?.(value);
  }

  function bypass(event: MouseEvent) {
    // Reconcile missed key events, including Alt held before Inspector was opened.
    setPassthrough(event.altKey);
    return passthrough || event.altKey;
  }

  function setVisible(value: boolean) {
    if (destroyed || visible === value) return;
    if (!value) endBatch(!passthrough);
    visible = value;
    if (!visible) {
      setPicking(false);
      hover = null;
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      drawing.replaceChildren();
      overlay.style.setProperty('display', 'none', 'important');
    } else {
      overlay.style.removeProperty('display');
      observeRoots();
      observeSizes();
      schedule();
    }
  }

  function eventElement(event: Event): Element | undefined {
    const path = event.composedPath();
    if (path.some((node) => node instanceof Element && excluded(node))) return undefined;
    const element = path.find((node): node is Element => node instanceof Element);
    return element ? (disabledControl(element) ?? element) : undefined;
  }

  function disabledControl(element: Element): Element | undefined {
    for (let node: Element | null = element; node; node = parentElement(node)) {
      if (node.matches('button, input, select, textarea, option, optgroup')) {
        return node.matches(':disabled') ? node : undefined;
      }
    }
    return undefined;
  }

  function choose(
    element: Element,
    point: { x: number; y: number },
    additive: boolean,
    textSelection?: TargetSnapshot['textSelection'],
  ) {
    ancestryHistory.clear();
    pointerPosition = point;
    if (additive) {
      shiftHeld = true;
      if (!batchActive) {
        const target = snapshot(element);
        targets = [target];
        batchActive = true;
        options.onBatchChange?.(true);
        changed();
      } else {
        if (
          targets.length === 20 &&
          !targets.some((target) => references.get(target.id)?.deref() === element)
        )
          return;
        select(element, true);
      }
    } else {
      endBatch(false);
      targets = [{ ...snapshot(element), ...(textSelection ? { textSelection } : {}) }];
      changed();
      commit(point);
    }
  }

  function clear() {
    if (destroyed) return;
    ancestryHistory.clear();
    if (press) cancelledPointer = press.pointerId;
    press = null;
    clearTextRange();
    endBatch(false);
    hover = null;
    drawing.replaceChildren();
    if (!targets.length) {
      observeSizes();
      return;
    }
    targets = [];
    changed();
  }

  function clearTextRange() {
    if (!textRange) return;
    const selected = document.getSelection();
    if (textRange && selected?.rangeCount) {
      const current = selected.getRangeAt(0);
      if (
        current.startContainer === textRange.startContainer &&
        current.startOffset === textRange.startOffset &&
        current.endContainer === textRange.endContainer &&
        current.endOffset === textRange.endOffset
      )
        selected.removeAllRanges();
    }
    textRange = null;
  }

  const listenerOptions = { capture: true, signal: abort.signal };
  document.addEventListener(
    'pointermove',
    (event) => {
      if (!picking) return;
      pointerPosition = { x: event.clientX, y: event.clientY };
      if (bypass(event)) return;
      if (press?.caret && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) {
        const end = textCaretAt(event.clientX, event.clientY, excluded);
        const range = end && rangeBetween(press.caret, end);
        if (range) {
          clearTextRange();
          textRange = range;
          const selected = document.getSelection();
          selected?.removeAllRanges();
          selected?.addRange(range);
        }
      }
      const element = eventElement(event) ?? null;
      if (hover === element) return;
      hover = element;
      observeSizes();
      schedule();
    },
    listenerOptions,
  );
  document.addEventListener(
    'pointerdown',
    (event) => {
      cancelledPointer = null;
      clearTextRange();
      handledRelease = null;
      press = null;
      if (!picking) return;
      passedGesture = bypass(event);
      if (passedGesture) return;
      const element = eventElement(event);
      if (!picking || !event.isPrimary || event.button !== 0 || !element) return;
      press = {
        element,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        caret:
          event.shiftKey || shiftHeld
            ? null
            : textCaretAt(event.clientX, event.clientY, excluded, true),
      };
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    listenerOptions,
  );
  document.addEventListener(
    'pointercancel',
    () => {
      cancelledPointer = null;
      clearTextRange();
      press = null;
      handledRelease = null;
      passedGesture = false;
    },
    listenerOptions,
  );
  document.addEventListener(
    'pointerup',
    (event) => {
      const start = press;
      press = null;
      if (!picking || bypass(event) || passedGesture) return;
      if (cancelledPointer === event.pointerId) {
        cancelledPointer = null;
        handledRelease = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
        };
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (
        !picking ||
        !event.isPrimary ||
        event.button !== 0 ||
        !start ||
        start.pointerId !== event.pointerId
      )
        return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) {
        handledRelease = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          time: performance.now(),
        };
        const end =
          eventElement(event) && start.caret
            ? textCaretAt(event.clientX, event.clientY, excluded)
            : null;
        const range = start.caret && end ? rangeBetween(start.caret, end) : null;
        const captured = range && captureTextRange(range, excluded);
        clearTextRange();
        event.preventDefault();
        event.stopImmediatePropagation();
        if (captured && !event.shiftKey && !shiftHeld)
          choose(
            captured.element,
            { x: event.clientX, y: event.clientY },
            false,
            captured.selection,
          );
        return;
      }
      clearTextRange();
      const source = eventElement(event);
      if (!source) return;
      const { element: hit } = hitTest(event.clientX, event.clientY);
      if (!hit || excluded(hit)) return;
      const element = disabledControl(hit);
      if (!element || element !== start.element) return;
      // Native disabled controls suppress click, but still dispatch pointer events.
      event.preventDefault();
      event.stopImmediatePropagation();
      handledRelease = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        time: performance.now(),
      };
      choose(element, { x: event.clientX, y: event.clientY }, event.shiftKey || shiftHeld);
    },
    listenerOptions,
  );
  document.addEventListener(
    'click',
    (event) => {
      if (!picking) return;
      if (bypass(event) || passedGesture) {
        passedGesture = false;
        return;
      }
      if (
        handledRelease &&
        event.detail !== 0 &&
        performance.now() - handledRelease.time < 500 &&
        Math.hypot(event.clientX - handledRelease.x, event.clientY - handledRelease.y) <= 6
      ) {
        handledRelease = null;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      const element = eventElement(event);
      if (!element) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(element, { x: event.clientX, y: event.clientY }, event.shiftKey || shiftHeld);
    },
    listenerOptions,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      handledRelease = null;
      if (!picking || event.isComposing || passthrough || event.altKey) return;
      if (event.key === 'Shift') {
        if (
          !event
            .composedPath()
            .some(
              (node) =>
                node instanceof Element &&
                (excluded(node) ||
                  node.matches('input,textarea,select') ||
                  (node instanceof HTMLElement && node.isContentEditable)),
            )
        )
          shiftHeld = true;
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        clear();
        options.onCancel?.();
      }
    },
    listenerOptions,
  );
  window.addEventListener(
    'keyup',
    (event) => {
      if (event.key === 'Shift') endBatch(!(passthrough || event.altKey));
    },
    listenerOptions,
  );
  window.addEventListener(
    'blur',
    () => {
      clearTextRange();
      pointerPosition = null;
      press = null;
      handledRelease = null;
      passedGesture = false;
      endBatch(!passthrough);
    },
    { signal: abort.signal },
  );
  document.addEventListener(
    'pointerout',
    (event) => {
      if (!event.relatedTarget) pointerPosition = null;
    },
    listenerOptions,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') {
        clearTextRange();
        pointerPosition = null;
        endBatch(!passthrough);
      }
    },
    { signal: abort.signal },
  );
  document.addEventListener('scroll', schedule, listenerOptions);
  window.addEventListener('resize', schedule, { signal: abort.signal });
  observeRoots();

  function navigationCandidate(id: string, direction: 'parent' | 'back') {
    const target = targets.find((target) => target.id === id);
    if (!target) return;
    const current = resolve(target).element;
    if (!current || !usable(current)) return;
    const previous = ancestryHistory.get(id)?.at(-1);
    const candidate =
      direction === 'parent' ? parentElement(current) : previous && resolve(previous).element;
    if (
      !candidate ||
      !usable(candidate) ||
      candidate === document.documentElement ||
      (direction === 'back' && parentElement(candidate) !== current) ||
      targets.some((other) => other.id !== id && resolve(other).element === candidate)
    )
      return;
    return { candidate, previous };
  }

  return {
    targetNavigation(id: string) {
      return {
        parent: !!navigationCandidate(id, 'parent'),
        back: !!navigationCandidate(id, 'back'),
      };
    },
    navigateTarget(id: string, direction: 'parent' | 'back') {
      const found = navigationCandidate(id, direction);
      if (!found) return false;
      const index = targets.findIndex((target) => target.id === id);
      const history = ancestryHistory.get(id) ?? [];
      const replacement =
        direction === 'parent' ? snapshot(found.candidate) : structuredClone(found.previous!);
      const nextHistory =
        direction === 'parent'
          ? [...history, structuredClone(targets[index]!)]
          : history.slice(0, -1);
      ancestryHistory.delete(id);
      ancestryHistory.set(replacement.id, nextHistory);
      targets[index] = replacement;
      clearTextRange();
      changed();
      return true;
    },
    resetPage() {
      clear();
      references.clear();
      watched.clear();
      ancestryHistory.clear();
      elementIds = new WeakMap();
    },
    setTheme(theme: string) {
      if (!destroyed && overlay.dataset.theme !== theme) overlay.dataset.theme = theme;
    },
    setVisible,
    setPicking,
    select,
    setTargets,
    remove(id: string) {
      if (destroyed || !targets.some((target) => target.id === id)) return;
      targets = targets.filter((target) => target.id !== id);
      changed();
    },
    parent() {
      const last = targets.at(-1);
      const element = last && resolve(last).element;
      const parent = element && parentElement(element);
      if (parent) select(parent);
    },
    clear,
    getTargets,
    getRect,
    availability,
    // Focusing an annotation intentionally replaces the editable selection.
    focus: setTargets,
    destroy() {
      if (destroyed) return;
      clearTextRange();
      destroyed = true;
      interactionKeys?.abort();
      interactionKeys = undefined;
      passedGesture = false;
      if (passthrough) {
        passthrough = false;
        options.onPassthroughChange?.(false);
      }
      endBatch(false);
      abort.abort();
      observer.disconnect();
      resize.disconnect();
      cancelAnimationFrame(frame);
      frame = 0;
      overlay.remove();
      hover = null;
      press = null;
      handledRelease = null;
      targets = [];
      references.clear();
      watched.clear();
      ancestryHistory.clear();
      elementIds = new WeakMap();
      if (picking) {
        picking = false;
        options.onPickingChange?.(false);
      }
    },
  };
}
