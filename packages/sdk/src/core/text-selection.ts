import type { TargetSnapshot } from '@ainotation/schema';
import { parentElement, closestAcrossShadow, hitTest } from './dom';

export type TextCaret = { node: Text; offset: number };
type Excluded = (element: Element) => boolean;

function readable(node: Text, excluded: Excluded) {
  for (let element: Element | null = node.parentElement; element;) {
    if (
      excluded(element) ||
      element.matches('input, textarea, select, script, style, noscript, [contenteditable]')
    )
      return false;
    const style = getComputedStyle(element);
    if (
      style.display === 'none' ||
      style.opacity === '0' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    )
      return false;
    element = parentElement(element);
  }
  return true;
}

export function textCaretAt(
  x: number,
  y: number,
  excluded: Excluded,
  precise = false,
): TextCaret | null {
  const { element: hit, shadowRoots } = hitTest(x, y);
  if (
    !hit ||
    excluded(hit) ||
    closestAcrossShadow(hit, 'button, input, textarea, select, [contenteditable]')
  )
    return null;
  const api = document as unknown as {
    caretPositionFromPoint?: (
      x: number,
      y: number,
      options: { shadowRoots: ShadowRoot[] },
    ) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const position = api.caretPositionFromPoint?.(x, y, { shadowRoots });
  const fallback = position ? null : api.caretRangeFromPoint?.(x, y);
  const node = position?.offsetNode ?? fallback?.startContainer;
  const offset = position?.offset ?? fallback?.startOffset ?? 0;
  if (!(node instanceof Text) || !readable(node, excluded)) return null;
  if (precise) {
    const range = document.createRange();
    const start = Math.max(0, Math.min(offset, node.length - 1));
    range.setStart(node, start);
    range.setEnd(node, Math.min(start + 1, node.length));
    if (
      ![...range.getClientRects()].some(
        (rect) => x >= rect.left - 3 && x <= rect.right + 3 && y >= rect.top && y <= rect.bottom,
      )
    )
      return null;
  }
  return { node, offset };
}

export function rangeBetween(start: TextCaret, end: TextCaret): Range | null {
  if (
    !start.node.isConnected ||
    !end.node.isConnected ||
    start.offset < 0 ||
    start.offset > start.node.length ||
    end.offset < 0 ||
    end.offset > end.node.length ||
    start.node.getRootNode() !== end.node.getRootNode()
  )
    return null;
  const a = document.createRange();
  a.setStart(start.node, start.offset);
  a.collapse(true);
  const b = document.createRange();
  b.setStart(end.node, end.offset);
  b.collapse(true);
  const backwards = a.compareBoundaryPoints(Range.START_TO_START, b) > 0;
  const range = document.createRange();
  range.setStart(backwards ? end.node : start.node, backwards ? end.offset : start.offset);
  range.setEnd(backwards ? start.node : end.node, backwards ? start.offset : end.offset);
  return range;
}

function rangeText(range: Range, excluded: Excluded, limit: number, tail = false) {
  const root = range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null = root instanceof Text ? root : walker.nextNode();
  let result = '';
  let visited = 0;
  while (node && visited++ < 4096) {
    if (node instanceof Text && range.intersectsNode(node) && readable(node, excluded)) {
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.length;
      result += node.data.slice(start, end);
      if (tail) result = result.slice(-limit);
      else if (result.length > limit) return { text: result.slice(0, limit), truncated: true };
    }
    node = walker.nextNode();
  }
  return { text: result, truncated: !!node };
}

export function captureTextRange(
  range: Range,
  excluded: Excluded,
): { element: Element; selection: NonNullable<TargetSnapshot['textSelection']> } | null {
  const node = range.commonAncestorContainer;
  const element = node instanceof Element ? node : node.parentElement;
  if (!element || excluded(element) || range.collapsed) return null;
  const captured = rangeText(range, excluded, 1000);
  if (!captured.text) return null;
  const context =
    element.parentElement && !excluded(element.parentElement) ? element.parentElement : element;
  const before = document.createRange();
  before.selectNodeContents(context);
  before.setEnd(range.startContainer, range.startOffset);
  const after = document.createRange();
  after.selectNodeContents(context);
  after.setStart(range.endContainer, range.endOffset);
  return {
    element,
    selection: {
      exact: captured.text,
      prefix: rangeText(before, excluded, 64, true).text,
      suffix: rangeText(after, excluded, 64).text,
      truncated: captured.truncated,
      rects: [...range.getClientRects()]
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .slice(0, 32)
        .map(({ x, y, width, height }) => ({ x, y, width, height })),
    },
  };
}
