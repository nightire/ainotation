import type { TargetSnapshot } from '@ainotation/schema';
import { parentElement as parent, closestAcrossShadow } from './dom';
import { descriptiveToken } from './selector';

const attributeNames = [
  'id',
  'class',
  'data-testid',
  'data-element',
  'role',
  'aria-label',
  'disabled',
  'aria-disabled',
  'aria-expanded',
  'aria-describedby',
  'aria-labelledby',
  'aria-hidden',
  'aria-checked',
  'aria-selected',
  'aria-required',
  'aria-invalid',
  'tabindex',
  'type',
  'name',
  'placeholder',
  'alt',
  'href',
  'for',
  'readonly',
  'required',
];

export function captureAttributes(element: Element): Record<string, string> {
  // Keep a useful image identity without capturing embedded data or signed/query URLs.
  const src = element.localName === 'img' ? element.getAttribute('src') : null;
  const imageSource =
    src && src.length <= 1000 && !/[?#]/.test(src) && !/^(?:data|blob):/i.test(src) ? ['src'] : [];
  return Object.fromEntries(
    [...attributeNames, ...imageSource].flatMap((name) => {
      const value = element.getAttribute(name);
      return value === null ? [] : [[name, value.slice(0, 1000)]];
    }),
  );
}

export function captureDomContext(
  element: Element,
  excluded: (element: Element) => boolean,
  text: (element: Element) => string,
): Pick<
  TargetSnapshot,
  | 'label'
  | 'ancestors'
  | 'ancestryTruncated'
  | 'nearbyText'
  | 'nearbyElements'
  | 'siblingCount'
  | 'accessibility'
> {
  const summary = (node: Element, includeText: boolean) => ({
    tagName: node.localName.slice(0, 100),
    attributes: Object.fromEntries(
      ['id', 'class', 'role', 'aria-label'].flatMap((name) => {
        const value = node.getAttribute(name);
        return value === null ? [] : [[name, value.slice(0, 256)]];
      }),
    ),
    ...(includeText ? { text: text(node).slice(0, 160) } : {}),
    ...(node.shadowRoot ? { shadowHost: true } : {}),
  });
  const ancestors = [];
  let node = parent(element);
  while (node && ancestors.length < 32 && !excluded(node)) {
    ancestors.unshift(summary(node, false));
    node = parent(node);
  }
  const visible = (item: Element) => {
    const style = getComputedStyle(item);
    return (
      !excluded(item) &&
      item.getClientRects().length > 0 &&
      style.opacity !== '0' &&
      style.visibility !== 'hidden' &&
      style.visibility !== 'collapse'
    );
  };
  const container = element.parentNode;
  const children =
    container instanceof Element || container instanceof ShadowRoot
      ? Array.from(container.children)
      : [];
  const index = children.indexOf(element);
  let previous: Element | undefined;
  let next: Element | undefined;
  const nearby: Element[] = [];
  for (let distance = 1; distance <= Math.min(64, children.length); distance++) {
    const before = children[index - distance];
    const after = children[index + distance];
    if (before && visible(before)) {
      previous ??= before;
      if (nearby.length < 4) nearby.push(before);
    }
    if (after && visible(after)) {
      next ??= after;
      if (nearby.length < 4) nearby.push(after);
    }
    if (nearby.length === 4 && previous && next) break;
  }
  const attributes = captureAttributes(element);
  const description =
    attributes['data-element'] ||
    attributes['aria-label'] ||
    attributes.alt ||
    attributes.placeholder ||
    text(element).slice(0, 80) ||
    attributes.name ||
    attributes.href ||
    '';
  const focusable =
    !closestAcrossShadow(element, '[inert]') &&
    !element.matches(':disabled, input[type="hidden"]') &&
    visible(element) &&
    element.matches(
      'a[href], area[href], button, input, select, textarea, summary, iframe, [tabindex], [contenteditable=""], [contenteditable="true"]',
    );
  return {
    label: `${element.localName}${
      description
        ? ` ${JSON.stringify(description)}`
        : Array.from(element.classList)
            .filter(descriptiveToken)
            .slice(0, 2)
            .map((name) => `.${name}`)
            .join('')
    }`.slice(0, 160),
    ancestors,
    ancestryTruncated: !!node,
    nearbyText: {
      before: previous ? text(previous).slice(0, 160) : '',
      after: next ? text(next).slice(0, 160) : '',
    },
    nearbyElements: nearby.map((item) => summary(item, true)),
    siblingCount: Math.max(0, children.length - 1),
    accessibility: { focusable },
  };
}
