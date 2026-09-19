import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { TargetSnapshot, StyleProperty } from '@ainotation/schema';
import { createStyleEditor } from './style-editor';
import { createSelection } from './selection';

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((dispose) => dispose()));

it('holds variant target overrides without losing drafts or changing preview preferences', () => {
  const { element, target, editor } = setup();
  const original = element.style.paddingTop;
  editor.edit('padding-top', '24px');
  expect(element.style.paddingTop).toBe('24px');
  const drafts = editor.drafts();
  const preference = editor.preference();
  editor.holdForVariants([target.id]);
  expect(element.style.paddingTop).toBe(original);
  expect(editor.drafts()).toEqual(drafts);
  expect(editor.preference()).toEqual(preference);
  editor.global(false);
  editor.global(true);
  expect(element.style.paddingTop).toBe(original);
  editor.holdForVariants([]);
  expect(element.style.paddingTop).toBe('24px');
});

it.each(['padding', 'margin'] as const)(
  'edits and restores %s by all sides or axis as one undo operation',
  (family) => {
    const { element, target, editor } = setup();
    element.style.setProperty(family, '4px 8px 12px 16px');
    editor.reset([target]);
    const property = (side: string) => `${family}-${side}` as StyleProperty;
    const values = () =>
      ['top', 'right', 'bottom', 'left'].map((side) =>
        element.style.getPropertyValue(property(side)),
      );
    expect(editor.edit(property('left'), '20px', 'horizontal')).toBe(true);
    expect(values()).toEqual(['4px', '20px', '12px', '20px']);
    editor.history('undo');
    expect(values()).toEqual(['4px', '8px', '12px', '16px']);
    editor.history('redo');
    expect(values()).toEqual(['4px', '20px', '12px', '20px']);
    editor.remove(property('left'), 'horizontal');
    expect(values()).toEqual(['4px', '8px', '12px', '16px']);
    editor.edit(property('top'), '10px', true);
    expect(values()).toEqual(['10px', '10px', '10px', '10px']);
    editor.remove(property('top'), true);
    expect(values()).toEqual(['4px', '8px', '12px', '16px']);
    editor.step(property('left'), 1, false, 'horizontal');
    expect(values()).toEqual(['4px', '9px', '12px', '17px']);
    editor.step(property('top'), -1, false, 'vertical');
    expect(values()).toEqual(['3px', '9px', '11px', '17px']);
    editor.history('undo');
    expect(values()).toEqual(['4px', '9px', '12px', '17px']);
    editor.history('undo');
    expect(values()).toEqual(['4px', '8px', '12px', '16px']);
    if (family === 'margin') {
      expect(editor.edit(property('top'), '-8px', true)).toBe(true);
      expect(values()).toEqual(['-8px', '-8px', '-8px', '-8px']);
      expect(editor.edit(property('top'), 'auto', true)).toBe(true);
      expect(editor.step(property('top'), 1, false, true)).toBe(false);
    } else {
      expect(editor.edit(property('top'), '-8px', true)).toBe(false);
      expect(values()).toEqual(['4px', '8px', '12px', '16px']);
    }
  },
);

it('recovers delayed hidden targets even with no active preview, without accepting replacement nodes', async () => {
  const host = document.createElement('section');
  const button = document.createElement('button');
  button.id = `deferred-${crypto.randomUUID()}`;
  button.textContent = 'Deferred target';
  button.style.padding = '8px';
  host.append(button);
  document.body.append(host);
  const capture = createSelection({ onChange() {} });
  capture.select(button);
  const target = capture.getTargets()[0]!;
  capture.destroy();
  host.hidden = true;
  const selection = createSelection({ visible: false, onChange() {} });
  const editor = createStyleEditor((target) => selection.getElement(target));
  cleanup.push(() => {
    editor.destroy();
    selection.destroy();
    host.remove();
  });
  editor.reset([
    { ...target, styleChanges: [{ property: 'padding-top', before: '8px', value: '20px' }] },
  ]);
  expect(editor.state().problem).toBe('missing');
  expect(button.style.paddingTop).toBe('8px');
  host.hidden = false;
  await vi.waitFor(() => expect(button.style.paddingTop).toBe('20px'));
  expect(editor.state().problem).toBeNull();
  const replacement = document.createElement('button');
  replacement.id = button.id;
  replacement.textContent = button.textContent;
  replacement.style.padding = '8px';
  button.replaceWith(replacement);
  await vi.waitFor(() => expect(editor.state().problem).toBe('missing'));
  host.hidden = true;
  host.hidden = false;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(replacement.style.paddingTop).toBe('8px');
  expect(editor.preview(true, true)).toBe(false);
});

it('restores a remembered editing subset without broadening to other retained targets', () => {
  const nodes = new Map<string, HTMLElement>();
  const targets: TargetSnapshot[] = [0, 1, 2].map((index) => {
    const element = document.createElement('button');
    element.style.padding = `${index + 8}px`;
    document.body.append(element);
    const id = crypto.randomUUID();
    nodes.set(id, element);
    return {
      id,
      selector: `#subset-${index}`,
      shadowHosts: [],
      tagName: 'button',
      text: '',
      attributes: {},
      rect: { x: 0, y: 0, width: 20, height: 20 },
      styles: {},
    };
  });
  const editor = createStyleEditor((target) => nodes.get(target.id) ?? null);
  cleanup.push(() => {
    editor.destroy();
    nodes.forEach((node) => node.remove());
  });
  editor.reset(targets);
  editor.selectScope([targets[0]!.id, targets[1]!.id]);
  expect(editor.active()).toBe('__selection__');
  expect(editor.state().scopeCount).toBe(2);
  editor.edit('padding-top', '20px');
  expect([...nodes.values()].map((node) => node.style.paddingTop)).toEqual([
    '20px',
    '20px',
    '10px',
  ]);
  expect(editor.editingTargets()).toEqual([targets[0]!.id, targets[1]!.id]);
});

it('does not trust an explicit shared key that resolves to a different live element', () => {
  const a = document.createElement('button'),
    b = document.createElement('button');
  a.style.color = 'blue';
  b.style.color = 'green';
  document.body.append(a, b);
  const target: TargetSnapshot = {
    id: crypto.randomUUID(),
    selector: 'button',
    shadowHosts: [],
    tagName: 'button',
    text: '',
    attributes: {},
    styles: {},
    rect: { x: 0, y: 0, width: 20, height: 20 },
  };
  const other: TargetSnapshot = {
    ...target,
    id: crypto.randomUUID(),
    styleTargetId: target.id,
    styleChanges: [{ property: 'color', before: 'green', value: 'red' }],
  };
  const editor = createStyleEditor((snapshot) => (snapshot.id === target.id ? a : b));
  cleanup.push(() => {
    editor.destroy();
    a.remove();
    b.remove();
  });
  editor.reset([other, target]);
  expect(editor.state().scopeCount).toBe(2);
  expect(editor.state().problem).toBe('missing');
  expect(editor.edit('color', 'pink')).toBe(false);
  expect(editor.preview(true, true)).toBe(false);
  expect(a.style.color).toBe('blue');
  expect(b.style.color).toBe('green');
});

it('shares styles only for the same resolved DOM node and rejects partial batch edits', () => {
  const a = document.createElement('button'),
    b = document.createElement('button');
  a.style.padding = '8px';
  b.style.padding = '12px';
  document.body.append(a, b);
  const snapshot = (id: string): TargetSnapshot => ({
    id,
    selector: '.same-selector',
    shadowHosts: [],
    tagName: 'button',
    text: '',
    attributes: {},
    rect: { x: 0, y: 0, width: 20, height: 20 },
    styles: {},
  });
  const first = snapshot(crypto.randomUUID()),
    alias = snapshot(crypto.randomUUID()),
    other = snapshot(crypto.randomUUID());
  const nodes = new Map([
    [first.id, a],
    [alias.id, a],
    [other.id, b],
  ]);
  const editor = createStyleEditor((target) => {
    const element = nodes.get(target.id);
    return element?.isConnected ? element : null;
  });
  cleanup.push(() => {
    editor.destroy();
    a.remove();
    b.remove();
  });
  editor.reset([first, other]);
  editor.begin([first]);
  editor.edit('padding-top', '20px');
  editor.begin([alias]);
  expect(editor.state().current['padding-top']).toBe('20px');
  expect(editor.project([alias])[0]!.styleTargetId).toBe(first.id);
  editor.edit('padding-top', '24px');
  editor.begin([first]);
  expect(editor.state().current['padding-top']).toBe('24px');
  expect(b.style.paddingTop).toBe('12px');
  editor.begin([first, other]);
  b.style.paddingTop = '14px';
  expect(editor.edit('padding-top', '40px')).toBe(false);
  expect(a.style.paddingTop).toBe('24px');
  expect(b.style.paddingTop).toBe('14px');
  b.style.paddingTop = '12px';
  editor.preview(true, true);
  b.remove();
  expect(editor.edit('padding-top', '40px')).toBe(false);
  expect(editor.project([first])[0]!.styleChanges![0]!.value).toBe('24px');
  expect(a.style.paddingTop).toBe('24px');
});
function setup() {
  const element = document.createElement('div');
  element.style.cssText =
    'padding: 8px 12px !important; border: 1px solid red; border-radius: 4px; color: blue;';
  document.body.append(element);
  const target: TargetSnapshot = {
    id: crypto.randomUUID(),
    selector: '#target',
    shadowHosts: [],
    tagName: 'div',
    text: '',
    attributes: {},
    rect: { x: 0, y: 0, width: 50, height: 50 },
    styles: { padding: '8px 12px' },
  };
  let current: Element | null = element;
  const notify = vi.fn();
  const editor = createStyleEditor(() => current, notify);
  editor.reset([target]);
  cleanup.push(() => {
    editor.destroy();
    element.remove();
  });
  return {
    element,
    target,
    editor,
    notify,
    replace: (next: Element | null) => {
      current = next;
    },
  };
}
it('restores exact inline declarations and priorities without modifying the captured target', () => {
  const { element, target, editor } = setup();
  const original = element.getAttribute('style');
  editor.preview(true);
  expect(editor.edit('padding-top', '20px')).toBe(true);
  expect(editor.edit('border-width', '5px')).toBe(true);
  expect(editor.edit('border-radius', '12px')).toBe(true);
  expect(getComputedStyle(element).paddingTop).toBe('20px');
  expect(editor.changedTargets()[0]!.styleChanges?.[0]).toEqual({
    property: 'padding-top',
    before: '8px',
    value: '20px',
  });
  expect(target.styles).toEqual({ padding: '8px 12px' });
  editor.suspend();
  expect(element.getAttribute('style')).toBe(original);
  expect(editor.state().count).toBe(3);
});
it('retains unrelated host writes and yields when the host replaces an owned declaration', async () => {
  const { element, editor, notify } = setup();
  editor.preview(true);
  editor.edit('padding-top', '20px');
  editor.edit('border-width', '4px');
  element.style.color = 'green';
  editor.suspend();
  expect(element.style.color).toBe('green');
  expect(getComputedStyle(element).paddingTop).toBe('8px');
  expect(element.style.getPropertyPriority('padding-top')).toBe('important');
  editor.preview(true);
  element.style.setProperty('padding-top', '44px');
  await vi.waitFor(() => expect(editor.state().problem).toBe('changed'));
  expect(notify).toHaveBeenCalled();
  expect(element.style.paddingTop).toBe('44px');
  expect(getComputedStyle(element).borderTopWidth).toBe('1px');
  expect(editor.state().globalPreview).toBe(true);
});
it('does not transfer previews to a replacement DOM node', () => {
  const { element, editor, replace } = setup();
  editor.preview(true);
  editor.edit('padding-top', '20px');
  const replacement = document.createElement('div');
  document.body.append(replacement);
  cleanup.push(() => replacement.remove());
  element.remove();
  replace(replacement);
  editor.reconcile();
  expect(editor.state().problem).toBe('missing');
  expect(replacement.hasAttribute('style')).toBe(false);
  expect(element.style.paddingTop).toBe('8px');
});
it('requires renewed confirmation when a host write is followed immediately by capture', () => {
  const { element, target, editor } = setup();
  editor.reset([
    { ...target, styleChanges: [{ property: 'padding-top', before: '4px', value: '20px' }] },
  ]);
  expect(editor.preview(true, true)).toBe(true);
  element.style.setProperty('padding-top', '44px');
  // A snapshot can run in the same task, before MutationObserver delivers the host write.
  editor.capture(() => expect(element.style.paddingTop).toBe('44px'));
  expect(element.style.paddingTop).toBe('44px');
  expect(editor.state().problem).toBe('changed');
  expect(editor.preview(true, true)).toBe(true);
  expect(element.style.paddingTop).toBe('20px');
  editor.destroy();
  expect(element.style.paddingTop).toBe('44px');
});
it('retains the global preview choice but requires confirmation for changed host styles', () => {
  const { element, target, editor } = setup();
  editor.reset([
    { ...target, styleChanges: [{ property: 'padding-top', before: '4px', value: '20px' }] },
  ]);
  expect(editor.state().globalPreview).toBe(true);
  expect(element.style.paddingTop).toBe('8px');
  expect(editor.preview(true)).toBe(false);
  expect(editor.state().problem).toBe('changed');
  expect(editor.preview(true, true)).toBe(true);
  expect(element.style.paddingTop).toBe('20px');
  editor.suspend();
  expect(element.style.paddingTop).toBe('8px');
});

it('temporarily restores the DOM for capture without losing preview or confirmed drift', () => {
  const { element, target, editor } = setup();
  editor.reset([
    { ...target, styleChanges: [{ property: 'padding-top', before: '4px', value: '20px' }] },
  ]);
  editor.preview(true, true);
  editor.capture(() => {
    expect(element.style.paddingTop).toBe('8px');
    expect(editor.state().preview).toBe(true);
    editor.select(target.id);
    expect(element.style.paddingTop).toBe('8px');
    editor.capture(() => expect(element.style.paddingTop).toBe('8px'));
    expect(element.style.paddingTop).toBe('8px');
  });
  expect(editor.state().preview).toBe(true);
  expect(editor.state().problem).toBeNull();
  expect(element.style.paddingTop).toBe('20px');
  expect(() =>
    editor.capture(() => {
      throw new Error('capture failed');
    }),
  ).toThrow('capture failed');
  expect(editor.state().preview).toBe(true);
  expect(element.style.paddingTop).toBe('20px');
});
it('undoes linked edits atomically, supports redo, and restores all changes', () => {
  const { element, editor } = setup();
  const original = element.getAttribute('style');
  editor.preview(true);
  editor.edit('padding-top', '24px', true);
  expect(editor.state().count).toBe(4);
  expect(getComputedStyle(element).padding).toBe('24px');
  editor.history('undo');
  expect(editor.state().count).toBe(0);
  expect(element.getAttribute('style')).toBe(original);
  editor.history('redo');
  expect(editor.state().count).toBe(4);
  editor.remove('padding-left');
  expect(editor.state().count).toBe(3);
  expect(getComputedStyle(element).paddingLeft).toBe('12px');
  editor.remove();
  expect(editor.state().count).toBe(0);
  expect(element.getAttribute('style')).toBe(original);
});
it('rejects resource-bearing and invalid values without changing the preview', () => {
  const { element, editor } = setup();
  const original = element.getAttribute('style');
  editor.preview(true);
  for (const value of [
    'url(https://example.com)',
    'var(--size)',
    '1px; color:red',
    'calc(bad)',
    '-1px',
  ])
    expect(editor.edit('width', value)).toBe(false);
  expect(element.getAttribute('style')).toBe(original);
  expect(editor.state().count).toBe(0);
});
