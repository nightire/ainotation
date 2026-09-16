import { excludedElement, toolNode } from './dom';

/** Own shadow-root subscriptions separately from content and geometry invalidation. */
export function createDomObserver(options: {
  onChange: () => void;
  exclude?: (element: Element) => boolean;
}) {
  const roots = new Set<Document | ShadowRoot>();
  const excluded = (element: Element) => excludedElement(element, options.exclude);
  const changesToolBoundary = (record: MutationRecord) =>
    record.type === 'attributes' && record.attributeName === 'data-ainotation-ui';
  const observer = new MutationObserver((records) => {
    // Moved/marked hosts already look excluded when mutation records are delivered.
    // Release their subscriptions before filtering out ordinary tool UI activity.
    const staleRoots =
      records.some((record) => record.type === 'childList' || changesToolBoundary(record)) &&
      [...roots].some(
        (root) => root instanceof ShadowRoot && (!root.host.isConnected || excluded(root.host)),
      );
    const meaningful = records.filter(
      (record) =>
        changesToolBoundary(record) ||
        (!toolNode(record.target) &&
          (record.type !== 'childList' ||
            [...record.addedNodes, ...record.removedNodes].some((node) => !toolNode(node)))),
    );
    if (!meaningful.length && !staleRoots) return;
    const topologyChanged = meaningful.some((record) =>
      record.type === 'childList'
        ? [...record.addedNodes, ...record.removedNodes].some((node) => node instanceof Element)
        : record.type === 'attributes' &&
          (record.attributeName === 'data-ainotation-ui' || !!options.exclude),
    );
    if (topologyChanged || staleRoots) refresh();
    else {
      // attachShadow itself emits no mutation. Discover a new root when its host changes.
      for (const record of meaningful)
        if (record.target instanceof Element) visitHost(record.target);
    }
    options.onChange();
  });

  function visitHost(element: Element) {
    if (element.shadowRoot && !excluded(element)) visit(element.shadowRoot);
  }
  function visit(root: Document | ShadowRoot) {
    if (roots.has(root)) return;
    roots.add(root);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true,
    });
    for (const element of root.querySelectorAll('*')) visitHost(element);
  }
  function disconnect() {
    observer.disconnect();
    roots.clear();
  }
  function refresh() {
    // Rebuilding after topology changes releases removed shadow trees.
    disconnect();
    visit(document);
  }
  return { refresh, disconnect };
}
