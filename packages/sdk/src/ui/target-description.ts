import type { TargetSnapshot } from '@ainotation/schema';
import { descriptiveToken } from '../core/selector';

export function targetDescription(target: TargetSnapshot): string {
  const ancestors = target.ancestors ?? [];
  const useful = ancestors
    .filter(
      (node) =>
        ['header', 'nav', 'main', 'footer', 'dialog', 'form'].includes(node.tagName) ||
        node.attributes['aria-label'],
    )
    .slice(-2);
  const context = useful.map((node) => {
    const label = node.attributes['aria-label'];
    const name = (node.attributes.class ?? '').split(/\s+/).find(descriptiveToken);
    return `${node.tagName}${label ? ` ${JSON.stringify(label)}` : name ? `.${name}` : ''}`;
  });
  const classes = (target.attributes.class ?? '').split(/\s+/).filter(descriptiveToken).slice(0, 2);
  const label =
    target.label && target.label !== target.tagName
      ? target.label
      : `${target.tagName}${classes.map((name) => `.${name}`).join('')}`;
  return [...context, label].join(' › ');
}

/** Shadow boundaries are explicit; this is not a made-up shadow-piercing CSS selector. */
export function targetLocatorText(target: TargetSnapshot): string {
  return target.shadowHosts.length
    ? `Shadow hosts:\n${target.shadowHosts.join('\n')}\nSelector:\n${target.selector}`
    : target.selector;
}
