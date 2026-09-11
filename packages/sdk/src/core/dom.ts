/** Parent traversal for actual DOM identity, including open shadow boundaries. */
export function parentElement(element: Element): Element | null {
  const root = element.getRootNode();
  return element.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
}

export function closestAcrossShadow(element: Element, selector: string): Element | null {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.matches(selector)) return current;
  }
  return null;
}

export function excludedElement(
  element: Element,
  exclude?: (element: Element) => boolean,
): boolean {
  for (let current: Element | null = element; current; current = parentElement(current)) {
    if (current.hasAttribute('data-ainotation-ui') || exclude?.(current)) return true;
  }
  return false;
}

export function toolNode(node: Node): boolean {
  const element =
    node instanceof Element ? node : node instanceof ShadowRoot ? node.host : node.parentElement;
  return !!element && excludedElement(element);
}

export function hitTest(
  x: number,
  y: number,
): { element: Element | null; shadowRoots: ShadowRoot[] } {
  const shadowRoots: ShadowRoot[] = [];
  let element = document.elementFromPoint(x, y);
  while (element?.shadowRoot) {
    shadowRoots.push(element.shadowRoot);
    const child = element.shadowRoot.elementFromPoint(x, y);
    if (!child || child === element) break;
    element = child;
  }
  return { element, shadowRoots };
}
