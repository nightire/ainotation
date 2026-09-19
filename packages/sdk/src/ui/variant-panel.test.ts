import { createFeedbackDocument, createVariantExploration } from '@ainotation/schema';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { page } from 'vite-plus/test/browser/context';
import { emptyViewState, type InspectorViewState } from '../core/types';
import { locales } from '../i18n';
import { createMarkerLayer } from './markers';

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
  await page.viewport(800, 600);
});
function setup(overrides: Partial<InspectorViewState> = {}) {
  const document = createFeedbackDocument(location.href);
  const target = {
    id: crypto.randomUUID(),
    selector: '#variant-panel-target',
    tagName: 'button',
    shadowHosts: [],
    text: 'Action',
    attributes: {},
    styles: {},
    rect: { x: 20, y: 20, width: 100, height: 40 },
  };
  const exploration = createVariantExploration(crypto.randomUUID(), [target.id]);
  exploration.status = 'published';
  exploration.revision = 2;
  exploration.manifest = {
    generation: 1,
    choices: [
      { id: 'compact', label: 'Compact' },
      { id: 'bold', label: 'Bold' },
      { id: 'soft', label: 'Soft' },
    ],
  };
  const annotation = {
    id: crypto.randomUUID(),
    comment: 'Explore designs',
    createdAt: document.createdAt,
    updatedAt: document.createdAt,
    page: {
      url: document.url,
      title: 'Variants',
      viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
    },
    targets: [target],
    variants: exploration,
    status: 'pending' as const,
    replies: [],
  };
  document.annotations.push(annotation);
  const view: InspectorViewState = {
    ...emptyViewState(),
    document,
    storage: 'ready',
    connection: 'connected',
    variantsSupported: true,
    variantAnnotationId: annotation.id,
    variantPreview: { status: 'ready', generation: 1, variantId: 'original', problem: null },
    ...overrides,
  };
  const onAction = vi.fn();
  const layer = createMarkerLayer({ onAction, getRect: () => null });
  cleanups.push(() => layer.destroy());
  layer.update(view, true);
  const root = window.document.querySelector('[data-ainotation-ui="markers"]')!.shadowRoot!;
  const panel = root.querySelector<HTMLElement>('.variants-controller')!;
  const button = (step: string) =>
    root.querySelector<HTMLButtonElement>(`[data-variant-step="${step}"]`)!;
  return { view, layer, root, panel, onAction, button };
}
function pointer(panel: HTMLElement, type: string, x: number, y: number, pointerType = 'mouse') {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    isPrimary: true,
    pointerId: 42,
    pointerType,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX: x,
    clientY: y,
  });
  panel.dispatchEvent(event);
  return event;
}

it('shows one design with wraparound previous/next navigation and no ready explanation', async () => {
  await page.viewport(1000, 800);
  const { view, layer, root, panel, onAction, button } = setup();
  expect(root.querySelector('.variant-name')?.textContent).toBe('Original');
  expect(root.querySelector('.variant-page')?.textContent).toBe('Round 1 · 1/4');
  expect(panel.textContent).not.toContain('Compare candidates, then record your decision');
  expect(panel.textContent).not.toContain('Compact');
  const open = root.querySelector<HTMLButtonElement>(
    '.variants-actions [data-action="variant-open"]',
  )!;
  expect(open.textContent?.trim()).toBe('View annotation');
  open.click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'edit', id: view.variantAnnotationId });
  const cancel = root.querySelector<HTMLButtonElement>('.variants-actions button:last-child')!;
  expect(cancel.textContent?.trim()).toBe('Cancel');
  expect(cancel.classList.contains('danger')).toBe(true);
  expect(root.querySelectorAll('.variants-heading button')).toHaveLength(1);
  button('next').click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'variant-preview', value: 'compact' });
  button('previous').click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'variant-preview', value: 'soft' });
  layer.update({ ...view, variantPreview: { ...view.variantPreview, variantId: 'compact' } }, true);
  expect(root.querySelector('.variant-name')?.textContent).toBe('Compact');
  expect(root.querySelector('.variant-page')?.textContent).toBe('Round 1 · 2/4');
  expect(panel.textContent).not.toContain('Bold');
  button('previous').click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'variant-preview', value: 'original' });
  const accepted = structuredClone(view);
  accepted.document!.annotations[0]!.variants!.status = 'accepted';
  layer.update(accepted, true);
  expect(button('next').disabled).toBe(true);
  expect(button('previous').disabled).toBe(true);
  expect(panel.textContent).toContain('Ask your agent to apply it');
  for (const locale of locales) {
    layer.update({ ...view, locale }, true);
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.variants-actions button')];
    expect(buttons).toHaveLength(4);
    expect(new Set(buttons.map((button) => button.getBoundingClientRect().top)).size).toBe(1);
    for (const button of buttons)
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
  }
});

it('requires modal confirmation, preserves the preview on return and restores focus', async () => {
  const { view, layer, root, onAction } = setup({ variantFeedback: 'Keep this feedback' });
  const cancel = root.querySelector<HTMLButtonElement>('[data-action="variant-cancel"]')!;
  const dialog = root.querySelector<HTMLDialogElement>('.variant-confirm')!;
  const keep = dialog.querySelector<HTMLButtonElement>('[data-action="variant-keep"]')!;
  const confirm = dialog.querySelector<HTMLButtonElement>(
    '[data-action="variant-confirm-cancel"]',
  )!;
  cancel.click();
  expect(dialog.matches(':modal')).toBe(true);
  expect(root.activeElement).toBe(keep);
  expect(onAction).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Keep comparing', exact: true }).click();
  expect(dialog.open).toBe(false);
  expect(root.activeElement).toBe(cancel);
  expect(onAction).not.toHaveBeenCalled();
  cancel.click();
  dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(dialog.open).toBe(false);
  expect(root.activeElement).toBe(cancel);
  cancel.click();
  layer.update({ ...view, theme: 'dark', locale: 'zh-Hans' }, true);
  expect(dialog.matches(':modal')).toBe(true);
  expect(dialog.textContent).toContain('结束这次探索？');
  expect(view.variantFeedback).toBe('Keep this feedback');
  expect(onAction).not.toHaveBeenCalled();
  confirm.click();
  confirm.click();
  expect(dialog.open).toBe(false);
  expect(onAction).toHaveBeenCalledExactlyOnceWith({
    type: 'variant-decision',
    decision: 'cancel',
  });
});

it('unlocks the variants toggle only after cleanup completes', () => {
  const { view, layer, root } = setup();
  const editing = {
    ...view,
    editingId: view.variantAnnotationId,
    editorOpen: true,
    selected: view.document!.annotations[0]!.targets,
  };
  for (const status of ['requested', 'published', 'accepted', 'cancelled', 'completed'] as const) {
    const next = structuredClone(editing);
    next.document!.annotations[0]!.variants!.status = status;
    layer.update(next, true);
    const toggle = root.querySelector<HTMLButtonElement>('[data-action="variants-toggle"]')!;
    expect(toggle.disabled).toBe(status !== 'completed');
    expect(toggle.getAttribute('aria-checked')).toBe(status === 'completed' ? 'false' : 'true');
    if (status === 'completed') {
      layer.update({ ...next, variantsRequested: true }, true);
      expect(toggle.disabled).toBe(false);
      expect(toggle.getAttribute('aria-checked')).toBe('true');
      layer.update({ ...next, variantsSupported: false }, true);
      expect(toggle.disabled).toBe(true);
    }
  }
});

it('dismisses stale confirmations when exploration, page or visibility changes', () => {
  const { view, layer, root, onAction } = setup();
  const cancel = root.querySelector<HTMLButtonElement>('[data-action="variant-cancel"]')!;
  const dialog = root.querySelector<HTMLDialogElement>('.variant-confirm')!;
  const confirm = dialog.querySelector<HTMLButtonElement>(
    '[data-action="variant-confirm-cancel"]',
  )!;
  const changed = structuredClone(view);
  changed.document!.annotations[0]!.variants!.revision++;
  const routed = structuredClone(view);
  routed.document!.url += '?different-page';
  for (const [next, visible] of [
    [changed, true],
    [routed, true],
    [{ ...view, variantMinimized: true }, true],
    [{ ...view, passthrough: true }, true],
    [view, false],
  ] as const) {
    layer.update(view, true);
    cancel.click();
    expect(dialog.matches(':modal')).toBe(true);
    layer.update(next, visible);
    expect(dialog.open).toBe(false);
    // A queued click on a now-closed dialog must not cancel the updated exploration.
    confirm.click();
    expect(onAction).not.toHaveBeenCalled();
  }
  layer.update(view, true);
  cancel.click();
  layer.destroy();
  expect(document.querySelector(':modal')).toBeNull();
  expect(onAction).not.toHaveBeenCalled();
});

it('centers the controller at the bottom and persists only completed blank-area drags', async () => {
  await page.viewport(1000, 800);
  const { view, layer, panel, onAction, button } = setup();
  vi.spyOn(panel, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(panel, 'hasPointerCapture').mockReturnValue(false);
  const before = panel.getBoundingClientRect();
  expect(before.x + before.width / 2).toBeCloseTo(500);
  expect(before.bottom).toBeCloseTo(784);
  pointer(panel, 'pointerdown', before.x + 3, before.y + 3);
  pointer(panel, 'pointermove', before.x + 83, before.y - 97);
  expect(panel.classList.contains('dragging')).toBe(true);
  expect(onAction).not.toHaveBeenCalled();
  pointer(panel, 'pointerup', before.x + 83, before.y - 97);
  const moved = panel.getBoundingClientRect();
  expect(moved.x).toBeCloseTo(before.x + 80);
  expect(moved.y).toBeCloseTo(before.y - 100);
  expect(onAction).toHaveBeenCalledExactlyOnceWith({
    type: 'variant-position',
    position: { x: moved.x, y: moved.y },
  });
  const strayClick = new MouseEvent('click', {
    bubbles: true,
    composed: true,
    cancelable: true,
    detail: 1,
    clientX: before.x + 83,
    clientY: before.y - 97,
  });
  button('next').dispatchEvent(strayClick);
  expect(strayClick.defaultPrevented).toBe(true);
  expect(onAction).toHaveBeenCalledOnce();
  layer.update(
    {
      ...view,
      variantPosition: { x: moved.x, y: moved.y },
      variantPreview: { ...view.variantPreview, variantId: 'compact' },
    },
    true,
  );
  expect(panel.getBoundingClientRect().x).toBeCloseTo(moved.x);
  expect(panel.getBoundingClientRect().y).toBeCloseTo(moved.y);
  onAction.mockClear();
  pointer(panel, 'pointerdown', moved.x + 3, moved.y + 3);
  pointer(panel, 'pointermove', moved.x + 23, moved.y + 23);
  panel.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  pointer(panel, 'pointerup', moved.x + 23, moved.y + 23);
  expect(panel.getBoundingClientRect().x).toBeCloseTo(moved.x);
  expect(panel.getBoundingClientRect().y).toBeCloseTo(moved.y);
  expect(onAction).not.toHaveBeenCalled();
});

it('clamps restored positions and keeps inputs, navigation buttons and touch scrolling native', async () => {
  await page.viewport(390, 740);
  const { view, layer, panel, root, onAction, button } = setup({
    variantPosition: { x: 2000, y: 2000 },
  });
  const capture = vi.spyOn(panel, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(panel, 'hasPointerCapture').mockReturnValue(false);
  const rect = panel.getBoundingClientRect();
  expect(rect.left).toBeGreaterThanOrEqual(8);
  expect(rect.right).toBeLessThanOrEqual(382);
  expect(rect.bottom).toBeLessThanOrEqual(732);
  root.querySelector('details')!.open = true;
  const input = root.querySelector<HTMLTextAreaElement>('[data-variant-feedback]')!;
  for (const element of [input, button('next'), root.querySelector<HTMLElement>('summary')!]) {
    pointer(element, 'pointerdown', rect.x + 5, rect.y + 5);
    expect(panel.classList.contains('dragging')).toBe(false);
  }
  expect(capture).not.toHaveBeenCalled();
  vi.spyOn(panel, 'scrollHeight', 'get').mockReturnValue(panel.clientHeight + 50);
  pointer(panel, 'pointerdown', rect.x + 3, rect.y + 3, 'touch');
  expect(capture).not.toHaveBeenCalled();
  panel.focus();
  panel.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
  expect(onAction.mock.calls.at(-1)?.[0].type).toBe('variant-position');
  layer.update({ ...view, variantPosition: null }, true);
  const centered = panel.getBoundingClientRect();
  expect(centered.x + centered.width / 2).toBeCloseTo(195);
  expect(centered.bottom).toBeCloseTo(668);
});

it('minimizes to a draggable title row and restores the same design and feedback', () => {
  const { view, layer, root, panel, onAction } = setup({
    variantPosition: { x: 150, y: 120 },
    variantFeedback: 'Keep these notes',
    variantsComparing: true,
  });
  const details = root.querySelector('details')!;
  details.open = true;
  const expandedHeight = panel.getBoundingClientRect().height;
  const toggle = () => root.querySelector<HTMLButtonElement>('[data-action="variant-minimize"]')!;
  expect(toggle().getAttribute('aria-expanded')).toBe('true');
  toggle().click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'variant-minimized', value: true });
  const minimized = { ...view, variantMinimized: true };
  layer.update(minimized, true);
  expect(toggle().getAttribute('aria-expanded')).toBe('false');
  expect(toggle().getAttribute('aria-label')).toBe('Expand panel');
  expect(root.querySelector<HTMLElement>('#ain-variants-content')!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('.variants-actions')!.getClientRects()).toHaveLength(0);
  expect(panel.getBoundingClientRect().height).toBeLessThan(expandedHeight);
  expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(60);
  expect(root.querySelector('.variant-name')?.textContent).toBe('Original');
  vi.spyOn(panel, 'setPointerCapture').mockImplementation(() => {});
  vi.spyOn(panel, 'hasPointerCapture').mockReturnValue(false);
  pointer(panel, 'pointerdown', 153, 123);
  pointer(panel, 'pointermove', 193, 163);
  pointer(panel, 'pointerup', 193, 163);
  const moved = panel.getBoundingClientRect();
  expect(onAction).toHaveBeenLastCalledWith({
    type: 'variant-position',
    position: { x: moved.x, y: moved.y },
  });
  layer.update({ ...minimized, variantPosition: { x: moved.x, y: moved.y } }, true);
  toggle().click();
  expect(onAction).toHaveBeenLastCalledWith({ type: 'variant-minimized', value: false });
  layer.update({ ...view, variantPosition: { x: moved.x, y: moved.y } }, true);
  expect(root.querySelector<HTMLElement>('#ain-variants-content')!.hidden).toBe(false);
  expect(root.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(root.querySelector<HTMLTextAreaElement>('[data-variant-feedback]')!.value).toBe(
    'Keep these notes',
  );
  expect(panel.getBoundingClientRect().x).toBe(moved.x);
  expect(panel.getBoundingClientRect().y).toBe(moved.y);
  expect(
    onAction.mock.calls.some(
      ([action]) => action.type === 'variant-decision' || action.type === 'variant-preview',
    ),
  ).toBe(false);
});
