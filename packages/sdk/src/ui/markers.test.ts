import type { Annotation, TargetSnapshot } from '@ainotation/schema';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser/context';

import { emptyViewState, type InspectorViewState } from '../core/types';
import { createMarkerLayer } from './markers';

const target: TargetSnapshot = {
  id: '22222222-2222-4222-8222-222222222222',
  selector: '#marker-target',
  shadowHosts: [],
  tagName: 'div',
  text: '',
  attributes: {},
  styles: {},
  rect: { x: 20, y: 30, width: 100, height: 40 },
};
const annotation: Annotation = {
  id: '11111111-1111-4111-8111-111111111111',
  comment: 'Keep this visible',
  createdAt: '2026-09-09T10:00:00.000Z',
  updatedAt: '2026-09-09T10:00:00.000Z',
  page: {
    url: 'http://localhost:5173/',
    title: 'Test',
    viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 10, scrollY: 50 },
  },
  targets: [target],
  marker: { x: 120, y: 100, space: 'viewport', targetId: target.id, ratioX: 1, ratioY: 1 },
  status: 'acknowledged',
  replies: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'agent',
      message: 'Private stored reply',
      createdAt: '2026-09-09T10:01:00.000Z',
    },
  ],
};
const second: Annotation = {
  ...annotation,
  id: '55555555-5555-4555-8555-555555555555',
  marker: { x: 220, y: 100, space: 'viewport' },
};
const cleanup: (() => void)[] = [];

it('accepts image paste and drop inside the feedback popover while preserving ordinary text paste', () => {
  const { root, onAction } = mount({
    editorOpen: true,
    marker: { x: 100, y: 100, space: 'viewport' },
  });
  const popover = root.querySelector('.popover')!;
  const file = new File(['png'], 'external.png', { type: 'image/png' });
  const data = new DataTransfer();
  data.items.add(file);
  const paste = new ClipboardEvent('paste', {
    clipboardData: data,
    bubbles: true,
    cancelable: true,
  });
  popover.dispatchEvent(paste);
  expect(paste.defaultPrevented).toBe(true);
  expect(onAction).toHaveBeenLastCalledWith({ type: 'import-image', file });
  const drop = new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true });
  popover.dispatchEvent(drop);
  expect(drop.defaultPrevented).toBe(true);
  expect(onAction).toHaveBeenLastCalledWith({ type: 'import-image', file });
  const text = new DataTransfer();
  text.setData('text/plain', 'Keep this text');
  const plain = new ClipboardEvent('paste', {
    clipboardData: text,
    bubbles: true,
    cancelable: true,
  });
  popover.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(false);
});

afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) dispose();
  vi.restoreAllMocks();
  await page.viewport(800, 600);
});

function mount(
  overrides: Partial<InspectorViewState> = {},
  getRect = vi.fn<(target: TargetSnapshot) => TargetSnapshot['rect'] | null>(() => null),
) {
  const view: InspectorViewState = {
    ...emptyViewState(),
    storage: 'ready',
    selected: [target],
    document: {
      schemaVersion: 1,
      id: '44444444-4444-4444-8444-444444444444',
      url: annotation.page.url,
      createdAt: annotation.createdAt,
      annotations: structuredClone([annotation, second]),
    },
    ...overrides,
  };
  const onAction = vi.fn();
  const layer = createMarkerLayer({ onAction, getRect });
  cleanup.push(() => layer.destroy());
  const host = document.querySelector<HTMLElement>('[data-ainotation-ui="markers"]')!;
  const root = host.shadowRoot!;
  layer.update(view, true);
  function control<T extends HTMLElement = HTMLButtonElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`Missing ${selector}`);
    return element;
  }
  return { view, layer, host, root, control, onAction, getRect };
}

function center(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function frames() {
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function fixture(tag = 'div') {
  const element = document.createElement(tag);
  document.body.append(element);
  cleanup.push(() => element.remove());
  return element;
}

describe('in-place annotation markers', () => {
  it('updates marker, editor and quote colors without replacing the draft or moving the caret', () => {
    const quoted = {
      ...target,
      textSelection: {
        exact: 'Selected words',
        prefix: '',
        suffix: '',
        truncated: false,
        rects: [],
      },
    };
    const { view, layer, root, host, control, onAction } = mount({
      editorOpen: true,
      marker: { x: 300, y: 150, space: 'viewport' },
      selected: [quoted],
      draft: 'Keep this draft',
    });
    const input = control<HTMLTextAreaElement>('textarea');
    input.focus();
    input.setSelectionRange(2, 6);
    const original = structuredClone(view);
    const light = getComputedStyle(control('.popover')).backgroundColor;
    const markerLight = getComputedStyle(control('.marker')).backgroundColor;
    layer.update({ ...view, theme: 'dark' }, true);
    expect(host.dataset.theme).toBe('dark');
    expect(getComputedStyle(control('.popover')).backgroundColor).not.toBe(light);
    expect(getComputedStyle(control('.marker')).backgroundColor).not.toBe(markerLight);
    expect(getComputedStyle(control('.layer')).colorScheme).toBe('dark');
    expect(root.activeElement).toBe(input);
    expect(input.value).toBe('Keep this draft');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 6]);
    expect(control('.text-quote').textContent).toContain('Selected words');
    expect(view).toEqual(original);
    expect(onAction).not.toHaveBeenCalled();
    layer.update(view, true);
    expect(getComputedStyle(control('.popover')).backgroundColor).toBe(light);
  });
  it('submits new and edited feedback with Meta+Enter only when the visible editor can save', () => {
    const { view, layer, control, onAction } = mount({
      editorOpen: true,
      marker: { x: 300, y: 150, space: 'viewport' },
      draft: 'Ready to save',
    });
    const press = (options: KeyboardEventInit = {}) => {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter',
        metaKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
        ...options,
      });
      control('textarea').dispatchEvent(event);
      return event;
    };
    expect(press().defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'save' });
    onAction.mockClear();
    layer.update({ ...view, editingId: annotation.id }, true);
    press();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'save' });
    onAction.mockClear();
    for (const patch of [{ draft: '  ' }, { saving: true }, { storage: 'loading' as const }]) {
      layer.update({ ...view, ...patch }, true);
      press();
    }
    expect(onAction).not.toHaveBeenCalled();
    layer.update(view, true);
    for (const options of [
      { metaKey: false },
      { isComposing: true },
      { repeat: true },
      { altKey: true },
      { ctrlKey: true },
      { shiftKey: true },
    ])
      press(options);
    expect(onAction).not.toHaveBeenCalled();
    expect(press({ metaKey: false }).defaultPrevented).toBe(false);
    layer.update(view, false);
    press();
    expect(onAction).not.toHaveBeenCalled();
  });
  it('renders opaque 24px numbered circles with Lucide pencil on hover and keyboard focus', async () => {
    const hostStyle = fixture('style');
    hostStyle.textContent =
      'button { padding: 100px !important; border: 20px solid red !important; font-size: 40px !important; }';
    const { root, host, control, onAction } = mount();
    expect(root.querySelectorAll('.marker')).toHaveLength(2);
    expect(getComputedStyle(host).pointerEvents).toBe('none');
    expect(getComputedStyle(host).zIndex).toBe('2147483647');
    const marker = control('[aria-label="Edit annotation 1"]');
    expect(marker.dataset.annotationId).toBe(annotation.id);
    expect(marker.getBoundingClientRect().width).toBe(24);
    expect(marker.getBoundingClientRect().height).toBe(24);
    expect(center(marker)).toEqual({ x: 120, y: 100 });
    expect(getComputedStyle(marker).backgroundColor).toBe('rgb(8, 127, 117)');
    expect(getComputedStyle(marker).fontSize).toBe('12px');
    expect(getComputedStyle(marker).borderRadius).toBe('50%');
    expect(getComputedStyle(control('.pencil')).display).toBe('none');
    expect(control('.pencil').querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    await page.getByRole('button', { name: 'Edit annotation 1', exact: true }).hover();
    expect(getComputedStyle(control('.number')).display).toBe('none');
    expect(getComputedStyle(control('.pencil')).display).toBe('flex');
    marker.click();
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'edit', id: annotation.id });
    const outside = fixture('textarea');
    outside.focus();
    marker.focus();
    expect(marker.matches(':focus-visible')).toBe(true);
    expect(getComputedStyle(control('.number')).display).toBe('none');
  });

  it('shows a pending plus and non-modal new feedback editor with draft and Add actions', () => {
    const { view, layer, root, control, onAction } = mount({
      editorOpen: true,
      marker: { x: 300, y: 150, space: 'viewport' },
    });
    const plus = control('[aria-label="New annotation"]');
    expect(plus.querySelector('svg')).not.toBeNull();
    expect(plus.getBoundingClientRect().width).toBe(24);
    expect(center(plus)).toEqual({ x: 300, y: 150 });
    expect(root.querySelectorAll('.marker')).toHaveLength(3);
    const dialog = control('[role="dialog"]');
    expect(dialog.getAttribute('aria-label')).toBe('New feedback');
    expect(dialog.hasAttribute('aria-modal')).toBe(false);
    const textarea = control<HTMLTextAreaElement>('textarea');
    expect(textarea.getAttribute('aria-label')).toBe('Feedback content');
    expect(root.querySelector('.popover h2, .popover label')).toBeNull();
    expect(control('.target-list').textContent).toContain(target.selector);
    expect(control('.target-list').getBoundingClientRect().bottom).toBeLessThanOrEqual(
      textarea.getBoundingClientRect().top,
    );
    expect(textarea.maxLength).toBe(10000);
    expect(root.activeElement).toBe(textarea);
    expect(control('.primary').disabled).toBe(true);
    textarea.value = 'Fix <button> spacing';
    textarea.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    expect(onAction).toHaveBeenLastCalledWith({ type: 'draft', value: textarea.value });
    layer.update({ ...view, draft: textarea.value }, true);
    control('.primary').click();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'save' });
    expect(control('.primary').getAttribute('aria-label')).toBe('Add');
    expect(control('.primary').textContent?.trim()).toBe('');
    expect(control('.primary').querySelector('svg')).not.toBeNull();
    for (const patch of [{ saving: true }, { storage: 'loading' as const }, { draft: '  ' }]) {
      layer.update({ ...view, draft: 'Feedback', ...patch }, true);
      expect(control('.primary').disabled).toBe(true);
    }
  });

  it('edits the saved circle without duplicates or exposing conversation and sends Cancel/Save/Delete', () => {
    const { view, layer, root, control, onAction } = mount({
      editorOpen: true,
      editingId: annotation.id,
      marker: annotation.marker!,
      draft: annotation.comment,
    });
    const original = structuredClone(view);
    expect(root.querySelectorAll('.marker')).toHaveLength(2);
    expect(root.querySelector('[aria-label="New annotation"]')).toBeNull();
    expect(control('[role="dialog"]').getAttribute('aria-label')).toBe('Edit feedback');
    const textarea = control<HTMLTextAreaElement>('textarea');
    expect(textarea.value).toBe(annotation.comment);
    expect(textarea.selectionStart).toBe(annotation.comment.length);
    expect(root.textContent).not.toMatch(/Private stored reply|acknowledged|resolved|reopen/i);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.actions button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Screenshot',
      'Choose image',
      'Cancel',
      'Save',
      'Delete',
    ]);
    for (const button of buttons.slice(2)) {
      expect(button.textContent?.trim()).toBe('');
      expect(button.title).toBe(
        button.classList.contains('primary')
          ? `${button.getAttribute('aria-label')} (Command/Super + Enter)`
          : button.getAttribute('aria-label'),
      );
      expect(button.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    }
    for (const button of buttons.slice(2)) button.click();
    expect(onAction.mock.calls.map(([action]) => action)).toEqual([
      { type: 'cancel-edit' },
      { type: 'save' },
      { type: 'delete', id: annotation.id },
    ]);
    layer.update({ ...view, saving: true }, true);
    expect(buttons[3]!.disabled).toBe(true);
    expect(buttons[4]!.disabled).toBe(true);
    expect(view).toEqual(original);
  });

  it('keeps nodes and caret through document updates, and focuses only committed editor changes', () => {
    const { view, layer, root, control } = mount({
      editorOpen: true,
      editingId: annotation.id,
      draft: 'Keep this text',
    });
    const marker = control(`[data-annotation-id="${annotation.id}"]`);
    const textarea = control<HTMLTextAreaElement>('textarea');
    textarea.setSelectionRange(2, 6);
    const next = structuredClone(view);
    next.document!.annotations.reverse();
    next.message = 'Synced';
    layer.update(next, true);
    expect(control('textarea')).toBe(textarea);
    expect(control(`[data-annotation-id="${annotation.id}"]`)).toBe(marker);
    expect(root.querySelectorAll('[data-annotation-id]')).toHaveLength(2);
    expect(root.activeElement).toBe(textarea);
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 6]);
    const outside = fixture('textarea');
    outside.focus();
    layer.update({ ...next, syncing: true }, true);
    expect(document.activeElement).toBe(outside);
    layer.update({ ...next, editingId: second.id, draft: 'Second' }, true);
    expect(root.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(6);
    layer.update({ ...next, editingId: null, marker: { x: 300, y: 100, space: 'viewport' } }, true);
    outside.focus();
    layer.update({ ...next, editingId: null, marker: { x: 330, y: 100, space: 'viewport' } }, true);
    expect(root.activeElement).toBe(textarea);
  });

  it('lists selected elements above the input and uses saved targets when editing', () => {
    const other = {
      ...target,
      id: crypto.randomUUID(),
      selector: 'button.other',
      text: '<script>unsafe</script>',
    };
    const { layer, view, root, control } = mount({
      editorOpen: true,
      marker: annotation.marker!,
      selected: [target, other],
    });
    expect(
      [...root.querySelectorAll('.target-list li')].map((item) => item.textContent?.trim()),
    ).toEqual([target.selector, other.selector]);
    expect(root.querySelector('script')).toBeNull();
    layer.update({ ...view, editingId: annotation.id, selected: [other] }, true);
    expect(control('.target-list').textContent?.trim()).toBe(target.selector);
    expect(root.querySelector('.popover h2, .popover label')).toBeNull();
  });

  it('uses live ratios, document scroll offsets, viewport anchors, and legacy last-target corners', () => {
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(40);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValue(70);
    const { view, layer, control, getRect } = mount();
    const saved = view.document!.annotations[0]!;
    saved.marker = {
      x: 180,
      y: 170,
      space: 'document',
      targetId: target.id,
      ratioX: 0.25,
      ratioY: 0.5,
    };
    layer.update(view, true);
    expect(center(control(`[data-annotation-id="${annotation.id}"]`))).toEqual({ x: 140, y: 100 });
    expect(center(control(`[data-annotation-id="${second.id}"]`))).toEqual({ x: 220, y: 100 });
    getRect.mockReturnValue({ x: 200, y: 240, width: 80, height: 60 });
    layer.update(view, true);
    expect(center(control(`[data-annotation-id="${annotation.id}"]`))).toEqual({ x: 220, y: 270 });
    delete saved.marker;
    saved.targets.push({ ...target, id: 'last', rect: { x: 150, y: 120, width: 60, height: 20 } });
    getRect.mockReturnValue(null);
    layer.update(view, true);
    expect(center(control(`[data-annotation-id="${annotation.id}"]`))).toEqual({ x: 180, y: 120 });
    getRect.mockImplementation((snapshot) =>
      snapshot.id === 'last' ? { x: 100, y: 200, width: 50, height: 30 } : null,
    );
    layer.update(view, true);
    expect(center(control(`[data-annotation-id="${annotation.id}"]`))).toEqual({ x: 150, y: 230 });
  });

  it('never substitutes another target for missing, mismatched, invalid-ratio, or throwing anchors', () => {
    const element = fixture();
    element.id = 'marker-target';
    element.style.cssText = 'position:fixed;left:500px;top:400px;width:30px;height:30px';
    const { view, layer, control, getRect, onAction } = mount();
    const marker = control(`[data-annotation-id="${annotation.id}"]`);
    expect(center(marker)).toEqual({ x: 120, y: 100 });
    expect(marker.title).toBe('Target unavailable');
    marker.click();
    expect(onAction).toHaveBeenLastCalledWith({ type: 'edit', id: annotation.id });
    getRect.mockImplementation(() => {
      throw new Error('Removed target');
    });
    expect(() => layer.update(view, true)).not.toThrow();
    expect(center(marker)).toEqual({ x: 120, y: 100 });
    getRect.mockReturnValue({ x: 500, y: 400, width: 30, height: 30 });
    for (const patch of [
      { targetId: 'unrelated' },
      { ratioX: Number.NaN },
      { ratioY: undefined },
    ]) {
      view.document!.annotations[0]!.marker = { ...annotation.marker!, ...patch };
      layer.update(view, true);
      expect(center(marker)).toEqual({ x: 120, y: 100 });
    }
  });

  it('hides offscreen circles while independently clamping the editor on desktop and mobile', async () => {
    const { view, layer, control } = mount({
      editorOpen: true,
      editingId: annotation.id,
      draft: 'Feedback',
    });
    for (const [width, height] of [
      [800, 600],
      [280, 320],
    ]) {
      await page.viewport(width!, height!);
      view.document!.annotations[0]!.marker = {
        x: width! + 100,
        y: height! + 100,
        space: 'viewport',
      };
      layer.update(view, true);
      expect(control(`[data-annotation-id="${annotation.id}"]`).hidden).toBe(true);
      const popover = control('.popover');
      const rect = popover.getBoundingClientRect();
      expect(rect.left).toBeGreaterThanOrEqual(8);
      expect(rect.top).toBeGreaterThanOrEqual(8);
      expect(rect.right).toBeLessThanOrEqual(width! - 8);
      expect(rect.bottom).toBeLessThanOrEqual(height! - 8);
      expect(rect.width).toBe(Math.min(320, width! - 16));
      expect(getComputedStyle(popover).overflowY).toBe('auto');
      expect(popover.scrollWidth).toBeLessThanOrEqual(popover.clientWidth);
      view.document!.annotations[0]!.marker = { x: 40, y: 40, space: 'viewport' };
      layer.update(view, true);
      expect(control(`[data-annotation-id="${annotation.id}"]`).hidden).toBe(false);
      expect(center(control(`[data-annotation-id="${annotation.id}"]`))).toEqual({ x: 40, y: 40 });
      expect(control('.popover').getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
    }
  });

  it('preserves draft and nodes while hidden without retaining or stealing focus', () => {
    const { view, layer, host, root, control, getRect } = mount({
      editorOpen: true,
      marker: annotation.marker!,
      draft: 'Unfinished',
    });
    const original = structuredClone(view);
    const textarea = control<HTMLTextAreaElement>('textarea');
    const outside = fixture('textarea');
    layer.update(view, false);
    expect(host.style.getPropertyPriority('display')).toBe('important');
    expect(getComputedStyle(host).display).toBe('none');
    expect(root.activeElement).toBeNull();
    outside.focus();
    getRect.mockClear();
    layer.update(view, false);
    expect(document.activeElement).toBe(outside);
    expect(getRect).not.toHaveBeenCalled();
    layer.update(view, true);
    expect(control('textarea')).toBe(textarea);
    expect(textarea.value).toBe('Unfinished');
    expect(document.activeElement).toBe(outside);
    expect(view).toEqual(original);
  });

  it('returns editor focus to a saved marker after closing and retains the marker after Add', () => {
    const { view, layer, root, control } = mount({
      editorOpen: true,
      editingId: annotation.id,
      draft: 'Edit',
    });
    const savedMarker = control(`[data-annotation-id="${annotation.id}"]`);
    layer.update({ ...view, editorOpen: false, editingId: null }, true);
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(root.activeElement).toBe(savedMarker);
    layer.update({ ...view, editingId: null, marker: { x: 300, y: 200, space: 'viewport' } }, true);
    const added = {
      ...annotation,
      id: 'new',
      marker: { x: 300, y: 200, space: 'viewport' as const },
    };
    layer.update(
      {
        ...view,
        editorOpen: false,
        editingId: null,
        document: { ...view.document!, annotations: [...view.document!.annotations, added] },
      },
      true,
    );
    expect(root.querySelectorAll('.marker')).toHaveLength(3);
    expect(root.querySelector('[aria-label="New annotation"]')).toBeNull();
    expect(root.activeElement).toBe(control('[data-annotation-id="new"]'));
    expect(center(control('[data-annotation-id="new"]'))).toEqual({ x: 300, y: 200 });
  });

  it('isolates tool clicks and Escape while keeping document capture shortcuts available', () => {
    const { control, onAction } = mount({ editorOpen: true, marker: annotation.marker! });
    const abort = new AbortController();
    cleanup.push(() => abort.abort());
    const click = vi.fn();
    const bubblingKey = vi.fn();
    const capture = vi.fn();
    document.addEventListener('click', click, { signal: abort.signal });
    document.addEventListener('keydown', bubblingKey, { signal: abort.signal });
    document.addEventListener('keydown', capture, { capture: true, signal: abort.signal });
    control('.actions button').click();
    expect(click).not.toHaveBeenCalled();
    onAction.mockClear();
    const textarea = control('textarea');
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    textarea.dispatchEvent(escape);
    expect(escape.defaultPrevented).toBe(true);
    expect(onAction).toHaveBeenCalledExactlyOnceWith({ type: 'cancel-edit' });
    expect(bubblingKey).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledOnce();
    const shortcut = new KeyboardEvent('keydown', {
      key: 'A',
      code: 'KeyA',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    textarea.dispatchEvent(shortcut);
    expect(shortcut.defaultPrevented).toBe(false);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(onAction).toHaveBeenCalledOnce();
  });

  it('refreshes live geometry on mutations, captured scroll, resize, and ResizeObserver without polling', async () => {
    const element = fixture();
    element.id = 'marker-target';
    element.style.cssText = 'position:fixed;left:40px;top:40px;width:80px;height:30px';
    const getRect = vi.fn(() => (element.isConnected ? element.getBoundingClientRect() : null));
    const { control, layer } = mount({}, getRect);
    const marker = control(`[data-annotation-id="${annotation.id}"]`);
    expect(center(marker)).toEqual({ x: 120, y: 70 });
    element.style.left = '100px';
    await vi.waitFor(() => expect(center(marker)).toEqual({ x: 180, y: 70 }));
    const stylesheet = fixture('style') as HTMLStyleElement;
    element.style.removeProperty('width');
    stylesheet.sheet!.insertRule('#marker-target { width: 90px; }');
    await vi.waitFor(() => expect(center(marker)).toEqual({ x: 190, y: 70 }));
    (stylesheet.sheet!.cssRules[0] as CSSStyleRule).style.width = '130px';
    await vi.waitFor(() => expect(center(marker)).toEqual({ x: 230, y: 70 }));
    await frames();
    getRect.mockClear();
    await frames();
    expect(getRect).not.toHaveBeenCalled();
    for (const source of [element, window, window.visualViewport!]) {
      source.dispatchEvent(new Event(source === element ? 'scroll' : 'resize'));
      await frames();
      expect(getRect).toHaveBeenCalled();
      getRect.mockClear();
    }
    const ui = fixture();
    ui.dataset.ainotationUi = 'other';
    await frames();
    getRect.mockClear();
    ui.style.width = '123px';
    ui.append(document.createElement('span'));
    await frames();
    expect(getRect).not.toHaveBeenCalled();
    layer.destroy();
    getRect.mockClear();
    element.style.width = '200px';
    window.dispatchEvent(new Event('resize'));
    element.dispatchEvent(new Event('scroll'));
    await frames();
    expect(getRect).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ainotation-ui="markers"]')).toBeNull();
  });

  it('observes saved targets inside shadow roots and releases removed roots', async () => {
    const element = fixture();
    element.id = 'marker-shadow';
    const shadow = element.attachShadow({ mode: 'open' });
    const child = document.createElement('div');
    child.id = 'marker-target';
    child.style.cssText = 'position:fixed;left:50px;top:50px;width:80px;height:30px';
    shadow.append(child);
    const saved = structuredClone(annotation);
    saved.targets[0]!.shadowHosts = ['#marker-shadow'];
    const getRect = vi.fn(() => (child.isConnected ? child.getBoundingClientRect() : null));
    const { view, layer, control } = mount({}, getRect);
    view.document!.annotations = [saved];
    layer.update(view, true);
    child.style.left = '90px';
    await vi.waitFor(() => expect(center(control('.marker'))).toEqual({ x: 170, y: 80 }));
    element.remove();
    await vi.waitFor(() => expect(control('.marker').title).toBe('Target unavailable'));
    expect(center(control('.marker'))).toEqual({ x: 120, y: 100 });
    await frames();
    getRect.mockClear();
    child.style.left = '200px';
    await frames();
    expect(getRect).not.toHaveBeenCalled();
  });
});
