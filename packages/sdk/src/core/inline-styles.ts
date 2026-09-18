import type { StyleChange } from '@ainotation/schema';

export type StyledElement = HTMLElement | SVGElement;
type Declaration = { value: string; priority: string };
export type InlineStylePreview = {
  element: StyledElement;
  original: string | null;
  written: string | null;
  before: Map<string, Declaration>;
  after: Map<string, Declaration>;
};

const declarations = (style: CSSStyleDeclaration) =>
  new Map(
    [...style].map((property) => [
      property,
      { value: style.getPropertyValue(property), priority: style.getPropertyPriority(property) },
    ]),
  );
const same = (a: Declaration | undefined, b: Declaration | undefined) =>
  a?.value === b?.value && a?.priority === b?.priority;

export function applyInlineStyles(
  element: StyledElement,
  changes: StyleChange[],
): InlineStylePreview {
  const original = element.getAttribute('style');
  const before = declarations(element.style);
  const touched = new Set<string>();
  const scratch = document.createElement('span').style;
  for (const change of changes) {
    scratch.cssText = '';
    scratch.setProperty(change.property, change.value, 'important');
    // CSSOM expands shorthands so ownership is tracked per actual declaration.
    for (const property of scratch) touched.add(property);
    element.style.setProperty(change.property, change.value, 'important');
  }
  return {
    element,
    original,
    before,
    after: new Map([...declarations(element.style)].filter(([property]) => touched.has(property))),
    written: element.getAttribute('style'),
  };
}

export function inlineStylesChanged(preview: InlineStylePreview): boolean {
  const current = declarations(preview.element.style);
  return [...preview.after].some(([property, value]) => !same(current.get(property), value));
}

export function restoreInlineStyles({
  element,
  original,
  written,
  before,
  after,
}: InlineStylePreview) {
  if (element.getAttribute('style') === written) {
    if (original === null) element.removeAttribute('style');
    else element.setAttribute('style', original);
    return;
  }
  const current = declarations(element.style);
  for (const [property, owned] of after) {
    if (!same(current.get(property), owned)) continue;
    const previous = before.get(property);
    if (previous) element.style.setProperty(property, previous.value, previous.priority);
    else element.style.removeProperty(property);
  }
}
