/** Descriptive tokens are preferred over generated identifiers and transient state. */
export function descriptiveToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 100 &&
    !/^(?:css-|sc-|emotion-|makeStyles-|:r|radix-|headlessui-)/i.test(value) &&
    !/^(?:(?:is|has)[-_])?(?:active|selected|open|closed|disabled|enabled|hidden|visible|focus|focused|hover|loading|checked)$/i.test(
      value,
    ) &&
    !/[a-f0-9]{8,}|\d{4,}/i.test(value) &&
    /[a-z\p{L}]/iu.test(value)
  );
}

const attributeSelector = (name: string, value: string) => `[${name}="${CSS.escape(value)}"]`;
function candidates(element: Element): string[] {
  const tag = CSS.escape(element.localName);
  const values: string[] = [];
  const id = element.getAttribute('id');
  if (id && descriptiveToken(id)) values.push(`#${CSS.escape(id)}`);
  for (const name of ['data-testid', 'data-element', 'name', 'aria-label', 'alt', 'title']) {
    const value = element.getAttribute(name);
    if (value && value.length <= 100 && !/[\r\n]/.test(value))
      values.push(`${name.startsWith('data-') ? '' : tag}${attributeSelector(name, value)}`);
  }
  const classes = Array.from(element.classList).filter(descriptiveToken).slice(0, 5);
  for (const name of classes) values.push(`.${CSS.escape(name)}`);
  for (const name of classes) values.push(`${tag}.${CSS.escape(name)}`);
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++)
      values.push(`.${CSS.escape(classes[i]!)}.${CSS.escape(classes[j]!)}`);
  }
  // A generated-looking ID can still be the best available locator, but loses to descriptions.
  if (id && !descriptiveToken(id) && id.length <= 256) values.push(`#${CSS.escape(id)}`);
  values.push(tag);
  return [...new Set(values)].slice(0, 24);
}

/** Bounded candidate search; every accepted selector resolves to the exact input node. */
export function selectorFor(element: Element, root: Document | ShadowRoot): string {
  let queries = 0;
  const unique = (selector: string) => {
    if (selector.length > 4000) return false;
    try {
      const matches = root.querySelectorAll(selector);
      return matches.length === 1 && matches[0] === element;
    } catch {
      return false;
    }
  };
  const attempt = (selector: string) => ++queries <= 256 && unique(selector);
  const leaves = candidates(element);
  for (const selector of leaves) if (attempt(selector)) return selector;
  // Stop at a useful ancestor rather than serializing every wrapper to the document root.
  let ancestor = element.parentElement;
  let best: { selector: string; cost: number } | undefined;
  for (
    let depth = 0;
    ancestor && depth < 8 && queries < 192;
    depth++, ancestor = ancestor.parentElement
  ) {
    const anchors = candidates(ancestor).slice(0, 6);
    for (const anchor of anchors) {
      for (const leaf of leaves.slice(0, 8)) {
        if (queries >= 192) break;
        const selector = `${anchor} ${leaf}`;
        if (attempt(selector)) {
          const cost =
            selector.length + (!/[.#[]/.test(anchor) ? 20 : 0) + (!/[.#[]/.test(leaf) ? 20 : 0);
          if (!best || cost < best.cost) best = { selector, cost };
        }
      }
    }
  }
  if (best) return best.selector;
  // Position is the last resort. Use the shortest verified suffix of an exact path.
  const parts: string[] = [];
  for (let current: Element | null = element; current; current = current.parentElement) {
    const siblings = Array.from((current.parentNode as Document | ShadowRoot | Element).children);
    const peers = siblings.filter(
      (sibling) =>
        sibling.localName === current!.localName && sibling.namespaceURI === current!.namespaceURI,
    );
    parts.unshift(
      `${CSS.escape(current.localName)}${peers.length > 1 ? `:nth-of-type(${peers.indexOf(current) + 1})` : ''}`,
    );
    const selector = parts.join(' > ');
    if (attempt(selector)) return selector;
    const id = current.parentElement?.getAttribute('id');
    if (id && descriptiveToken(id) && attempt(`#${CSS.escape(id)} > ${selector}`))
      return `#${CSS.escape(id)} > ${selector}`;
  }
  // Full-path fallback has its own final validation, even after the search budget is exhausted.
  const selector = parts.join(' > ');
  if (!unique(selector))
    throw new Error('Cannot create a unique target selector within the snapshot limits.');
  return selector;
}
