import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
  AnnotationSchema,
  MarkerAnchorSchema,
  PageSnapshotSchema,
  TargetSnapshotSchema,
} from '@ainotation/schema';
import type { createSelection } from './selection.js';

const selections: ReturnType<typeof createSelection>[] = [];
const fixtures: HTMLElement[] = [];

async function setup() {
  const module = await import('./selection.js');
  const onChange = vi.fn();
  const onPickingChange = vi.fn();
  const onPassthroughChange = vi.fn();
  const onSelect = vi.fn();
  const onBatchChange = vi.fn();
  const onCancel = vi.fn();
  const selection = module.createSelection({
    onChange,
    onPickingChange,
    onPassthroughChange,
    onSelect,
    onBatchChange,
    onCancel,
  });
  selections.push(selection);
  const fixture = document.createElement('div');
  fixture.id = `fixture-${crypto.randomUUID()}`;
  document.body.append(fixture);
  fixtures.push(fixture);
  return {
    selection,
    fixture,
    onChange,
    onPickingChange,
    onPassthroughChange,
    onSelect,
    onBatchChange,
    onCancel,
    ...module,
  };
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
};
const click = (element: Element, options: MouseEventInit = {}) =>
  element.dispatchEvent(
    new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, ...options }),
  );
const key = (
  type: 'keydown' | 'keyup',
  value: string,
  target: EventTarget = document,
  options: KeyboardEventInit = {},
) =>
  target.dispatchEvent(
    new KeyboardEvent(type, {
      key: value,
      bubbles: true,
      composed: true,
      cancelable: true,
      ...options,
    }),
  );

afterEach(() => {
  for (const selection of selections.splice(0)) selection.destroy();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  vi.restoreAllMocks();
  window.scrollTo(0, 0);
});

describe('selection in a real browser', () => {
  it('applies custom exclusions to descendants across shadow boundaries, including restored identities', async () => {
    const { fixture, createSelection } = await setup();
    const wrapper = document.createElement('div');
    const host = document.createElement('div');
    wrapper.append(host);
    fixture.append(wrapper);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<button>Nested target</button>';
    const button = root.querySelector('button')!;
    const selection = createSelection({
      onChange() {},
      exclude: (element) => element.hasAttribute('data-private'),
    });
    selections.push(selection);
    selection.select(button);
    const target = selection.getTargets()[0]!;
    wrapper.setAttribute('data-private', '');
    expect(selection.availability(target)).toBe('missing');
    expect(selection.getRect(target)).toBeNull();
    selection.clear();
    selection.select(button);
    expect(selection.getTargets()).toEqual([]);
  });
  it('listens for Alt only while picking and releases the temporary listeners on close', async () => {
    const { selection, fixture, onPassthroughChange, onSelect } = await setup();
    const button = document.createElement('button');
    button.textContent = 'Native interaction';
    fixture.append(button);
    key('keydown', 'Alt', document, { altKey: true });
    expect(onPassthroughChange).not.toHaveBeenCalled();
    selection.setPicking(true);
    key('keydown', 'Alt', document, { altKey: true });
    expect(onPassthroughChange.mock.calls).toEqual([[true]]);
    expect(click(button, { altKey: true })).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    selection.setVisible(false);
    expect(onPassthroughChange.mock.calls).toEqual([[true], [false]]);
    key('keydown', 'Alt', document, { altKey: true });
    key('keyup', 'Alt');
    expect(onPassthroughChange).toHaveBeenCalledTimes(2);
    selection.setVisible(true);
    selection.setPicking(true);
    key('keydown', 'Alt', document, { altKey: true });
    expect(onPassthroughChange).toHaveBeenCalledTimes(3);
    selection.destroy();
    expect(onPassthroughChange).toHaveBeenLastCalledWith(false);
    key('keydown', 'Alt', document, { altKey: true });
    expect(onPassthroughChange).toHaveBeenCalledTimes(4);
  });

  it('lets a gesture finish natively when Alt is released before pointerup', async () => {
    const { selection, fixture, onSelect } = await setup();
    const button = document.createElement('button');
    button.textContent = 'Native';
    fixture.append(button);
    const nativeClick = vi.fn();
    button.addEventListener('click', nativeClick);
    selection.setPicking(true);
    const down = new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      altKey: true,
    });
    expect(button.dispatchEvent(down)).toBe(true);
    key('keyup', 'Alt');
    button.dispatchEvent(
      new PointerEvent('pointerup', {
        bubbles: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
      }),
    );
    expect(click(button, { detail: 1 })).toBe(true);
    expect(nativeClick).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();
    button.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        composed: true,
        pointerId: 1,
        isPrimary: true,
        button: 0,
      }),
    );
    click(button, { detail: 1 });
    expect(onSelect).toHaveBeenCalledOnce();
    expect(nativeClick).toHaveBeenCalledOnce();
  });

  it('preserves selection and cancels batch completion during Alt interaction without getting stuck', async () => {
    const { selection, fixture, onSelect, onCancel } = await setup();
    const first = document.createElement('button');
    first.textContent = 'First';
    const second = document.createElement('button');
    second.textContent = 'Second';
    fixture.append(first, second);
    selection.setPicking(true);
    click(first, { shiftKey: true });
    const before = selection.getTargets();
    key('keydown', 'Alt', document, { altKey: true, shiftKey: true });
    expect(click(second, { altKey: true, shiftKey: true })).toBe(true);
    expect(selection.getTargets()).toEqual(before);
    expect(key('keydown', 'Escape', document, { altKey: true })).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
    key('keyup', 'Shift', document, { altKey: true });
    key('keyup', 'Alt');
    expect(onSelect).not.toHaveBeenCalled();
    click(second);
    expect(onSelect).toHaveBeenCalledOnce();
    expect(selection.getTargets()).toHaveLength(1);
    expect(selection.getTargets()[0]?.text).toBe('Second');
  });

  it('uses disabled pointer releases once even if a browser also delivers click', () => {
    return setup().then(({ selection, fixture, onSelect }) => {
      const button = document.createElement('button');
      button.disabled = true;
      button.textContent = 'Disabled';
      button.style.cssText = 'position:fixed;left:40px;top:80px;width:120px;height:40px';
      fixture.append(button);
      const pointer = (type: string, shiftKey = false) =>
        button.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            composed: true,
            cancelable: true,
            isPrimary: true,
            pointerId: 1,
            button: 0,
            clientX: 60,
            clientY: 100,
            shiftKey,
          }),
        );
      selection.setPicking(true);
      pointer('pointerdown');
      pointer('pointerup');
      expect(onSelect).toHaveBeenCalledOnce();
      expect(click(button, { detail: 1, clientX: 60, clientY: 100 })).toBe(false);
      expect(onSelect).toHaveBeenCalledOnce();
      expect(selection.getTargets()[0]?.attributes.disabled).toBe('');
      expect(button.disabled).toBe(true);
      selection.clear();
      onSelect.mockClear();
      key('keydown', 'Shift');
      pointer('pointerdown', true);
      pointer('pointerup', true);
      click(button, { detail: 1, clientX: 60, clientY: 100, shiftKey: true });
      expect(selection.getTargets()).toHaveLength(1);
      expect(onSelect).not.toHaveBeenCalled();
      key('keyup', 'Shift');
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onSelect.mock.lastCall![1]).toHaveLength(1);
    });
  });

  it('does not commit canceled, secondary or hidden disabled-pointer gestures', async () => {
    const { selection, fixture, onSelect } = await setup();
    const button = document.createElement('button');
    button.disabled = true;
    button.style.cssText = 'position:fixed;left:40px;top:80px;width:120px;height:40px';
    fixture.append(button);
    const send = (type: string, buttonCode = 0) =>
      button.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          isPrimary: true,
          pointerId: 1,
          button: buttonCode,
          clientX: 60,
          clientY: 100,
        }),
      );
    selection.setPicking(true);
    send('pointerdown');
    send('pointercancel');
    send('pointerup');
    send('pointerdown', 2);
    send('pointerup', 2);
    send('pointerdown');
    selection.setVisible(false);
    send('pointerup');
    expect(onSelect).not.toHaveBeenCalled();
    expect(selection.getTargets()).toEqual([]);
    expect(button.disabled).toBe(true);
  });

  it.each(['first', 'last', 'outside', 'covered'] as const)(
    'places a Shift batch at the pointer only over a selected target: %s',
    async (location) => {
      const { selection, fixture, onSelect } = await setup();
      const first = document.createElement('div');
      const last = document.createElement('div');
      first.textContent = 'First';
      last.textContent = 'Last';
      first.style.cssText = 'position:fixed;left:30px;top:70px;width:100px;height:50px';
      last.style.cssText = 'position:fixed;left:210px;top:70px;width:100px;height:50px';
      fixture.append(first, last);
      selection.setPicking(true);
      click(first, { shiftKey: true, clientX: 40, clientY: 80 });
      click(last, { shiftKey: true, clientX: 220, clientY: 80 });
      const selected = selection.getTargets();
      const point =
        location === 'outside'
          ? { x: 10, y: 200 }
          : location === 'last'
            ? { x: 250, y: 100 }
            : { x: 60, y: 90 };
      if (location === 'covered') {
        const covering = document.createElement('div');
        covering.dataset.ainotationUi = 'popover';
        covering.style.cssText =
          'position:fixed;left:30px;top:70px;width:100px;height:50px;z-index:100';
        fixture.append(covering);
      }
      document.dispatchEvent(
        new PointerEvent('pointermove', { bubbles: true, clientX: point.x, clientY: point.y }),
      );
      key('keyup', 'Shift');
      expect(onSelect).toHaveBeenCalledOnce();
      const anchor = onSelect.mock.calls[0]![0];
      const underSelection = location === 'first' || location === 'last';
      expect(anchor.x).toBe((underSelection ? point.x : 310) + scrollX);
      expect(anchor.y).toBe((underSelection ? point.y : 120) + scrollY);
      expect(anchor.targetId).toBe(selected[location === 'first' ? 0 : 1]!.id);
      expect(onSelect.mock.calls[0]![1].map((target: { id: string }) => target.id)).toEqual(
        selected.map((target) => target.id),
      );
    },
  );

  it('tests a moved pointer against current element geometry and open shadow descendants', async () => {
    const { selection, fixture, onSelect } = await setup();
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:40px;top:60px;width:120px;height:80px';
    const shadow = host.attachShadow({ mode: 'open' });
    const child = document.createElement('button');
    child.textContent = 'Shadow child';
    child.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
    shadow.append(child);
    fixture.append(host);
    selection.setPicking(true);
    click(host, { shiftKey: true, clientX: 50, clientY: 70 });
    document.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 70, clientY: 90 }),
    );
    key('keyup', 'Shift');
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ x: 70 + scrollX, y: 90 + scrollY });
    click(host, { shiftKey: true, clientX: 50, clientY: 70 });
    host.style.top = '200px';
    key('keyup', 'Shift');
    expect(onSelect.mock.calls[1]![0]).toMatchObject({
      x: 160 + scrollX,
      y: 280 + scrollY,
      ratioX: 1,
      ratioY: 1,
    });
  });

  it('hides interaction and highlights without losing targets, then redraws current geometry', async () => {
    const { selection, fixture, onChange } = await setup();
    const button = document.createElement('button');
    button.textContent = 'Retained target';
    fixture.append(button);
    selection.select(button);
    selection.setPicking(true);
    const targets = selection.getTargets();
    await settle();
    const overlay = document.querySelector<HTMLElement>('[data-ainotation-ui="selection"]')!;
    expect(overlay.shadowRoot!.querySelectorAll('.rect')).toHaveLength(1);
    onChange.mockClear();
    selection.setVisible(false);
    expect(getComputedStyle(overlay).display).toBe('none');
    expect(overlay.shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
    expect(selection.getTargets().map((target) => target.id)).toEqual(
      targets.map((target) => target.id),
    );
    expect(onChange).not.toHaveBeenCalled();
    const hostClick = vi.fn();
    button.addEventListener('click', hostClick);
    selection.setPicking(true);
    expect(click(button)).toBe(true);
    expect(hostClick).toHaveBeenCalledOnce();
    fixture.style.transform = 'translate(45px, 30px)';
    await settle();
    expect(overlay.shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
    selection.setVisible(true);
    await settle();
    const rectangle = overlay.shadowRoot!.querySelector<HTMLElement>('.rect')!;
    expect(Number.parseFloat(rectangle.style.left)).toBeCloseTo(button.getBoundingClientRect().x);
    expect(Number.parseFloat(rectangle.style.top)).toBeCloseTo(button.getBoundingClientRect().y);
    expect(selection.getTargets()[0]?.id).toBe(targets[0]?.id);
  });

  it('restores snapshots hidden and keeps missing targets without a stale rectangle', async () => {
    const { selection, fixture, createSelection } = await setup();
    const button = document.createElement('button');
    button.id = 'persisted-selection-target';
    button.textContent = 'Original';
    fixture.append(button);
    selection.select(button);
    const targets = selection.getTargets();
    selection.destroy();
    button.textContent = 'Different target';
    const restored = createSelection({ visible: false, onChange: vi.fn() });
    selections.push(restored);
    restored.setTargets(targets);
    const overlay = document.querySelector<HTMLElement>('[data-ainotation-ui="selection"]')!;
    await settle();
    expect(getComputedStyle(overlay).display).toBe('none');
    expect(restored.getTargets()).toEqual(targets);
    expect(restored.availability(targets[0]!)).toBe('missing');
    restored.setVisible(true);
    await settle();
    expect(overlay.shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
    expect(restored.getTargets()).toEqual(targets);
  });

  it('has no import side effects and captures serializable bounded page information', async () => {
    const before = document.querySelectorAll('[data-ainotation-ui]').length;
    const { capturePage } = await import('./selection.js');
    expect(document.querySelectorAll('[data-ainotation-ui]')).toHaveLength(before);
    const page = capturePage();
    expect(PageSnapshotSchema.parse(JSON.parse(JSON.stringify(page)))).toEqual(page);
    expect(page.viewport.scrollY).toBe(window.scrollY);
  });

  it('replaces, toggles, removes, parents and clears with stable IDs and an atomic shared limit', async () => {
    const { selection, fixture, onChange } = await setup();
    const buttons = Array.from({ length: 21 }, (_, index) => {
      const button = document.createElement('button');
      button.textContent = `Button ${index}`;
      fixture.append(button);
      return button;
    });
    selection.select(buttons[0]!);
    const first = selection.getTargets()[0]!;
    selection.select(buttons[0]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    selection.select(buttons[1]!, true);
    selection.select(buttons[0]!, true);
    expect(selection.getTargets()).toHaveLength(1);
    selection.select(buttons[0]!, true);
    expect(selection.getTargets()[1]!.id).toBe(first.id);
    selection.remove(first.id);
    selection.parent();
    expect(selection.getTargets()[0]!.attributes.id).toBe(fixture.id);
    selection.clear();
    for (const button of buttons.slice(0, 20)) selection.select(button, true);
    const calls = onChange.mock.calls.length;
    expect(() => selection.select(buttons[20]!, true)).toThrow('20');
    expect(() => selection.setTargets([...selection.getTargets(), first])).toThrow('20');
    expect(selection.getTargets()).toHaveLength(20);
    expect(AnnotationSchema.shape.targets.safeParse(selection.getTargets()).success).toBe(true);
    expect(
      AnnotationSchema.shape.targets.safeParse([...selection.getTargets(), first]).success,
    ).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(calls);
    selection.getTargets()[0]!.attributes.id = 'mutated copy';
    expect(selection.getTargets()[0]!.attributes.id).toBeUndefined();
  });

  it('picks the composed-path element in nested open shadow roots and restores escaped selectors', async () => {
    const { selection, fixture, createSelection, onPickingChange } = await setup();
    const outer = document.createElement('section');
    outer.id = 'outer:id.["x"]';
    fixture.append(outer);
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('article');
    inner.setAttribute('data-testid', 'inner "quoted" \\ root');
    outerRoot.append(inner);
    const innerRoot = inner.attachShadow({ mode: 'open' });
    const button = document.createElement('button');
    button.id = 'button:with.punctuation[1]';
    button.textContent = 'Choose';
    innerRoot.append(button);
    selection.setPicking(true);
    const pageClick = vi.fn();
    button.addEventListener('click', pageClick);
    expect(click(button)).toBe(false);
    expect(pageClick).not.toHaveBeenCalled();
    expect(onPickingChange.mock.calls).toEqual([[true]]);
    const target = selection.getTargets()[0]!;
    expect(target.shadowHosts).toHaveLength(2);
    expect(target.tagName).toBe('button');
    expect(TargetSnapshotSchema.parse(target)).toEqual(target);
    const restored = createSelection({ onChange: vi.fn() });
    selections.push(restored);
    restored.setTargets([JSON.parse(JSON.stringify(target))]);
    expect(restored.availability(target)).toBe('available');
    restored.parent();
    expect(restored.getTargets()[0]!.tagName).toBe('article');
  });

  it('reports ambiguous selectors and refuses fingerprint mismatches without fallback binding', async () => {
    const { selection, fixture, createSelection } = await setup();
    fixture.innerHTML = '<button id="duplicate">Same</button><button id="duplicate">Same</button>';
    selection.select(fixture.firstElementChild!);
    const target = selection.getTargets()[0]!;
    expect(document.querySelectorAll(target.selector)).toHaveLength(1);
    const restored = createSelection({ onChange: vi.fn() });
    selections.push(restored);
    const duplicate = { ...target, id: crypto.randomUUID(), selector: '#duplicate' };
    restored.setTargets([duplicate]);
    expect(restored.availability(duplicate)).toBe('ambiguous');
    const mismatch = { ...target, id: crypto.randomUUID(), text: 'Different' };
    restored.focus([mismatch]);
    expect(restored.availability(mismatch)).toBe('missing');
    expect(restored.getTargets()).toEqual([mismatch]);
    const attributeMismatch = {
      ...target,
      id: crypto.randomUUID(),
      attributes: { ...target.attributes, role: 'link' },
    };
    expect(restored.availability(attributeMismatch)).toBe('missing');
    const invalid = { ...target, id: crypto.randomUUID(), selector: '[' };
    expect(restored.availability(invalid)).toBe('missing');
    const hostA = document.createElement('div');
    const hostB = document.createElement('div');
    hostA.className = hostB.className = 'duplicate-host';
    fixture.append(hostA, hostB);
    hostA.attachShadow({ mode: 'open' });
    hostB.attachShadow({ mode: 'open' });
    expect(
      restored.availability({
        ...target,
        id: crypto.randomUUID(),
        shadowHosts: ['.duplicate-host'],
      }),
    ).toBe('ambiguous');
  });

  it('keeps detached native identities missing even after replacement and reloading saved snapshots', async () => {
    const { selection, fixture, onChange } = await setup();
    fixture.innerHTML = '<button id="replace-me">Original</button>';
    const original = fixture.firstElementChild!;
    selection.select(original);
    const target = selection.getTargets()[0]!;
    await settle();
    onChange.mockClear();
    original.replaceWith(original.cloneNode(true));
    await settle();
    expect(onChange).toHaveBeenCalledOnce();
    expect(selection.availability(target)).toBe('missing');
    expect(selection.getTargets()).toEqual([target]);
    selection.clear();
    selection.setTargets([target]);
    expect(selection.availability(target)).toBe('missing');
    fixture.replaceChildren(original);
    await settle();
    expect(selection.availability(target)).toBe('available');
    selection.select(original);
    expect(selection.getTargets()[0]!.id).toBe(target.id);
  });

  it('navigates each target independently and returns along the original child path', async () => {
    const { selection, fixture } = await setup();
    fixture.innerHTML =
      '<span class="wrapper"><img class="logo-light"><img class="logo-dark"></span><button>Other</button>';
    const image = fixture.querySelector('.logo-dark')!;
    const wrapper = image.parentElement!;
    const other = fixture.querySelector('button')!;
    selection.select(image);
    selection.select(other, true);
    const [original, untouched] = selection.getTargets();
    expect(selection.navigateTarget(original!.id, 'parent')).toBe(true);
    let [parent, second] = selection.getTargets();
    expect(parent!.tagName).toBe('span');
    expect(second!.id).toBe(untouched!.id);
    expect(selection.targetNavigation(parent!.id).back).toBe(true);
    expect(selection.navigateTarget(parent!.id, 'back')).toBe(true);
    expect(selection.getTargets()[0]!.id).toBe(original!.id);
    selection.navigateTarget(original!.id, 'parent');
    [parent] = selection.getTargets();
    image.remove();
    wrapper.append(image.cloneNode(true));
    expect(selection.targetNavigation(parent!.id).back).toBe(false);
    expect(selection.navigateTarget(parent!.id, 'back')).toBe(false);
  });

  it('crosses an open shadow boundary and avoids duplicate selected ancestors', async () => {
    const { selection, fixture } = await setup();
    const host = document.createElement('div');
    host.id = 'navigation-shadow-host';
    fixture.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Inside</button>';
    selection.select(shadow.firstElementChild!);
    const child = selection.getTargets()[0]!;
    selection.navigateTarget(child.id, 'parent');
    const parent = selection.getTargets()[0]!;
    expect(parent.shadowHosts).toEqual([]);
    expect(parent.selector).toBe('#navigation-shadow-host');
    selection.navigateTarget(parent.id, 'back');
    expect(selection.getTargets()[0]!.shadowHosts).toEqual(child.shadowHosts);
    selection.select(host, true);
    expect(selection.targetNavigation(child.id).parent).toBe(false);
  });

  it('rejects changed image identity on restoration and still reads legacy snapshots', async () => {
    const { selection, fixture, createSelection } = await setup();
    fixture.innerHTML = '<img class="identity-logo" src="/logo.svg" alt="Brand">';
    const image = fixture.firstElementChild!;
    selection.select(image);
    const target = selection.getTargets()[0]!;
    expect(target.selector).not.toContain('nth-of-type');
    expect(target.attributes.src).toBe('/logo.svg');
    image.setAttribute('src', '/other-logo.svg');
    const restored = createSelection({ onChange: vi.fn() });
    selections.push(restored);
    expect(restored.availability(target)).toBe('missing');
    image.setAttribute('src', '/logo.svg');
    image.setAttribute('alt', 'Other brand');
    expect(restored.availability(target)).toBe('missing');
    image.setAttribute('alt', 'Brand');
    expect(restored.availability(target)).toBe('available');
    const legacy = structuredClone(target);
    legacy.id = crypto.randomUUID();
    delete legacy.attributes.src;
    expect(restored.availability(legacy)).toBe('available');
    image.setAttribute('src', '/logo.svg?token=private');
    const signed = image.cloneNode(true) as Element;
    fixture.append(signed);
    selection.select(signed);
    expect(selection.getTargets()[0]!.attributes.src).toBeUndefined();
  });

  it('omits input secrets, hidden text, arbitrary attributes and tool text from snapshots', async () => {
    const { selection, fixture } = await setup();
    fixture.setAttribute('data-secret', 'private');
    fixture.setAttribute('aria-label', 'public label');
    fixture.innerHTML =
      '<span>Visible text</span><input type="password" value="secret-password"><textarea>secret-draft</textarea><script>secret-script</script><style>/* secret-style */</style><span hidden>hidden-secret</span><div data-ainotation-ui>tool-secret</div>';
    selection.select(fixture);
    const target = selection.getTargets()[0]!;
    expect(target.text).toBe('Visible text');
    expect(target.attributes).toEqual({ id: fixture.id, 'aria-label': 'public label' });
    expect(Object.keys(target.styles)).toEqual([
      'display',
      'position',
      'color',
      'background-color',
      'font-size',
      'font-weight',
      'padding',
      'margin',
      'width',
      'height',
      'transform',
      'border',
      'outline',
      'box-shadow',
      'border-color',
      'border-radius',
      'font-family',
      'line-height',
      'letter-spacing',
      'text-align',
      'top',
      'right',
      'bottom',
      'left',
      'z-index',
      'flex-direction',
      'justify-content',
      'align-items',
      'gap',
      'opacity',
      'visibility',
      'overflow',
    ]);
    expect(JSON.stringify(target)).not.toContain('secret');
    selection.select(fixture.querySelector('input')!);
    expect(selection.getTargets()[0]!.text).toBe('');
    expect(selection.getTargets()[0]!.attributes).toEqual({ type: 'password' });
    fixture.querySelector('span')!.textContent = 'x'.repeat(600);
    selection.select(fixture);
    expect(selection.getTargets()[0]!.text).toHaveLength(500);
  });

  it('refreshes viewport rectangles and drawing on scroll without onChange or overlay mutation loops', async () => {
    const { selection, fixture, onChange } = await setup();
    fixture.style.cssText =
      'height:100px;overflow:auto;position:fixed;top:20px;left:20px;width:200px';
    fixture.innerHTML =
      '<div style="height:500px;padding-top:120px"><button>Scroll target</button></div>';
    const button = fixture.querySelector('button')!;
    selection.select(button);
    const before = selection.getTargets()[0]!;
    await settle();
    onChange.mockClear();
    fixture.scrollTop = 70;
    await settle();
    const after = selection.getTargets()[0]!;
    expect(after.rect.y).toBe(before.rect.y - 70);
    const overlay = document.querySelector('[data-ainotation-ui="selection"]')!;
    const rectangle = overlay.shadowRoot!.querySelector<HTMLElement>('.rect')!;
    expect(parseFloat(rectangle.style.top)).toBe(after.rect.y);
    button.style.color = 'rgb(255, 0, 0)';
    await settle();
    expect(selection.getTargets()[0]!.styles.color).toBe('rgb(255, 0, 0)');
    expect(onChange).not.toHaveBeenCalled();
    await settle();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('respects tool and custom exclusions and complete destruction', async () => {
    const { selection, fixture, onChange, onPickingChange, createSelection } = await setup();
    fixture.innerHTML =
      '<button>First</button><button>Second</button><div data-ainotation-ui></div>';
    const first = fixture.children[0]!;
    const second = fixture.children[1]!;
    const tool = fixture.children[2]!;
    const toolButton = document.createElement('button');
    tool.attachShadow({ mode: 'open' }).append(toolButton);
    selection.setPicking(true);
    expect(click(toolButton)).toBe(true);
    const down = new PointerEvent('pointerdown', {
      bubbles: true,
      composed: true,
      cancelable: true,
      isPrimary: true,
    });
    expect(first.dispatchEvent(down)).toBe(false);
    click(first);
    click(second);
    expect(selection.getTargets()).toHaveLength(1);
    click(first);
    expect(selection.getTargets()).toHaveLength(1);
    expect(onPickingChange.mock.calls).toEqual([[true]]);
    first.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, composed: true }));
    selection.destroy();
    selection.destroy();
    onChange.mockClear();
    const handler = vi.fn();
    first.addEventListener('click', handler);
    expect(click(first)).toBe(true);
    expect(handler).toHaveBeenCalledOnce();
    fixture.append(document.createElement('div'));
    await settle();
    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector('[data-ainotation-ui="selection"]')).toBeNull();
    expect(selection.getTargets()).toEqual([]);
    expect(onPickingChange).toHaveBeenLastCalledWith(false);
    const custom = createSelection({ onChange: vi.fn(), exclude: (element) => element === first });
    selections.push(custom);
    custom.setPicking(true);
    expect(click(first)).toBe(true);
    custom.select(first);
    expect(custom.getTargets()).toEqual([]);
    click(second);
    expect(custom.getTargets()).toHaveLength(1);
  });

  it('commits every plain click at its coordinates and keeps picking, including Ctrl and Meta clicks', async () => {
    const { selection, fixture, onSelect, onPickingChange, onBatchChange } = await setup();
    fixture.innerHTML = '<button>First</button><button>Second</button>';
    const first = fixture.children[0]!;
    const second = fixture.children[1]!;
    selection.setPicking(true);
    for (const options of [{}, { ctrlKey: true }, { metaKey: true }]) {
      click(first, { clientX: 30, clientY: 40, ...options });
      const target = selection.getTargets()[0]!;
      const anchor = onSelect.mock.lastCall![0];
      expect(MarkerAnchorSchema.parse(anchor)).toEqual({
        x: 30 + window.scrollX,
        y: 40 + window.scrollY,
        space: 'document',
        targetId: target.id,
        ratioX: (30 - target.rect.x) / target.rect.width,
        ratioY: (40 - target.rect.y) / target.rect.height,
      });
      expect(onSelect.mock.lastCall![1]).toEqual([target]);
    }
    click(second);
    expect(selection.getTargets().map((target) => target.text)).toEqual(['Second']);
    expect(onSelect).toHaveBeenCalledTimes(4);
    expect(onPickingChange.mock.calls).toEqual([[true]]);
    expect(onBatchChange).not.toHaveBeenCalled();
    onSelect.mock.lastCall![1][0].text = 'Mutated callback payload';
    expect(selection.getTargets()[0]!.text).toBe('Second');
    second.textContent = 'Updated target';
    click(second);
    expect(onSelect.mock.lastCall![1][0].text).toBe('Updated target');
    expect(onSelect).toHaveBeenCalledTimes(5);
    await settle();
    const overlay = document.querySelector('[data-ainotation-ui="selection"]')!;
    expect(overlay.shadowRoot!.querySelectorAll('.rect')).toHaveLength(1);
    expect(overlay.shadowRoot!.querySelector('span')).toBeNull();
  });

  it('starts a fresh Shift batch lazily, toggles targets, and commits once on release over tool UI', async () => {
    const { selection, fixture, onSelect, onChange, onBatchChange, onPickingChange } =
      await setup();
    fixture.innerHTML =
      '<button>Previous</button><button>First</button><button>Second</button><div data-ainotation-ui></div>';
    const [previous, first, second, tool] = Array.from(fixture.children) as [
      Element,
      Element,
      Element,
      Element,
    ];
    const input = document.createElement('textarea');
    tool.attachShadow({ mode: 'open' }).append(input);
    selection.setPicking(true);
    click(previous);
    onSelect.mockClear();
    onChange.mockClear();
    key('keydown', 'Shift');
    expect(onBatchChange).not.toHaveBeenCalled();
    expect(selection.getTargets()[0]!.text).toBe('Previous');
    click(first);
    expect(selection.getTargets().map((target) => target.text)).toEqual(['First']);
    selection.setPicking(true);
    key('keydown', 'Shift', document, { repeat: true });
    click(second);
    click(first);
    expect(selection.getTargets().map((target) => target.text)).toEqual(['Second']);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBatchChange.mock.calls).toEqual([[true]]);
    input.focus();
    const focused = tool.shadowRoot!.activeElement;
    expect(click(input, { shiftKey: true })).toBe(true);
    (second as HTMLElement).style.transform = 'translate(20px, 30px)';
    key('keyup', 'Shift', input);
    const target = selection.getTargets()[0]!;
    expect(onSelect.mock.calls).toEqual([
      [
        {
          x: target.rect.x + target.rect.width + window.scrollX,
          y: target.rect.y + target.rect.height + window.scrollY,
          space: 'document',
          targetId: target.id,
          ratioX: 1,
          ratioY: 1,
        },
        [target],
      ],
    ]);
    expect(tool.shadowRoot!.activeElement).toBe(focused);
    key('keyup', 'Shift');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
    expect(onPickingChange.mock.calls).toEqual([[true]]);
    click(first, { shiftKey: true });
    key('keyup', 'Shift');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(onSelect.mock.lastCall![1].map((item: { text: string }) => item.text)).toEqual([
      'First',
    ]);
  });

  it('ends empty Shift batches without committing and leaves key-only Shift gestures inert', async () => {
    const { selection, fixture, onSelect, onBatchChange } = await setup();
    fixture.innerHTML = '<button>Target</button>';
    const button = fixture.firstElementChild!;
    selection.setPicking(true);
    selection.select(button);
    key('keydown', 'Shift');
    key('keyup', 'Shift');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBatchChange).not.toHaveBeenCalled();
    click(button, { shiftKey: true });
    click(button, { shiftKey: true });
    expect(selection.getTargets()).toEqual([]);
    key('keyup', 'Shift');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
    click(button);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('rejects a 21st Shift target atomically while allowing removals and subsequent additions', async () => {
    const { selection, fixture, onSelect, onChange, onBatchChange } = await setup();
    const buttons = Array.from({ length: 21 }, (_, index) => {
      const button = document.createElement('button');
      button.textContent = `Target ${index}`;
      fixture.append(button);
      return button;
    });
    selection.setPicking(true);
    for (const button of buttons.slice(0, 20)) click(button, { shiftKey: true });
    const before = selection.getTargets();
    const changes = onChange.mock.calls.length;
    click(buttons[20]!, { shiftKey: true });
    expect(selection.getTargets()).toEqual(before);
    expect(onChange).toHaveBeenCalledTimes(changes);
    expect(onSelect).not.toHaveBeenCalled();
    expect(onBatchChange.mock.calls).toEqual([[true]]);
    click(buttons[19]!, { shiftKey: true });
    click(buttons[20]!, { shiftKey: true });
    document.dispatchEvent(new PointerEvent('pointerout', { relatedTarget: null }));
    key('keyup', 'Shift');
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.lastCall![1]).toHaveLength(20);
    expect(onSelect.mock.lastCall![0].targetId).toBe(selection.getTargets().at(-1)!.id);
  });

  it('ignores composing and editable/tool Shift keydowns but supports the click modifier fallback', async () => {
    const { selection, fixture, onSelect, onBatchChange } = await setup();
    fixture.innerHTML =
      '<button>Target</button><textarea></textarea><div data-ainotation-ui></div>';
    const button = fixture.children[0]!;
    const textarea = fixture.children[1] as HTMLTextAreaElement;
    const tool = fixture.children[2]!;
    const toolInput = document.createElement('input');
    tool.attachShadow({ mode: 'open' }).append(toolInput);
    selection.setPicking(true);
    key('keydown', 'Shift', button, { isComposing: true });
    click(button);
    textarea.focus();
    key('keydown', 'Shift', textarea);
    click(button);
    toolInput.focus();
    key('keydown', 'Shift', toolInput, { metaKey: true });
    expect(click(toolInput, { metaKey: true })).toBe(true);
    click(button);
    expect(onSelect).toHaveBeenCalledTimes(3);
    expect(onBatchChange).not.toHaveBeenCalled();
    click(button, { shiftKey: true });
    expect(onSelect).toHaveBeenCalledTimes(3);
    key('keyup', 'Shift', toolInput);
    expect(onSelect).toHaveBeenCalledTimes(4);
  });

  it('Escape cancels a batch and draft without committing or disabling picking', async () => {
    const { selection, fixture, onSelect, onBatchChange, onCancel, onPickingChange } =
      await setup();
    fixture.innerHTML = '<button>Target</button>';
    const button = fixture.firstElementChild!;
    selection.setPicking(true);
    click(button, { shiftKey: true });
    expect(key('keydown', 'Escape', document, { isComposing: true })).toBe(true);
    expect(selection.getTargets()).toHaveLength(1);
    expect(key('keydown', 'Escape')).toBe(false);
    expect(selection.getTargets()).toEqual([]);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
    key('keyup', 'Shift');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onPickingChange.mock.calls).toEqual([[true]]);
    click(button);
    expect(onSelect).toHaveBeenCalledOnce();
    key('keydown', 'Escape');
    expect(selection.getTargets()).toEqual([]);
    expect(onCancel).toHaveBeenCalledTimes(2);
    click(button, { shiftKey: true });
    selection.clear();
    key('keyup', 'Shift');
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it.each(['blur', 'visibility', 'hide', 'stop'] as const)(
    'finalizes a pending batch once on %s and resets the modifier',
    async (reason) => {
      const { selection, fixture, onSelect, onBatchChange } = await setup();
      fixture.innerHTML = '<button>Target</button>';
      const button = fixture.firstElementChild!;
      selection.setPicking(true);
      key('keydown', 'Shift');
      click(button);
      if (reason === 'blur') window.dispatchEvent(new Event('blur'));
      if (reason === 'visibility') {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
      }
      if (reason === 'hide') selection.setVisible(false);
      if (reason === 'stop') selection.setPicking(false);
      key('keyup', 'Shift');
      expect(onSelect).toHaveBeenCalledOnce();
      expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
      expect(selection.getTargets()).toHaveLength(1);
      selection.setVisible(true);
      selection.setPicking(true);
      click(button);
      expect(onSelect).toHaveBeenCalledTimes(2);
      expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
    },
  );

  it('cancels an active batch on destruction and removes all keyboard and lifecycle listeners', async () => {
    const { selection, fixture, onSelect, onBatchChange, onCancel } = await setup();
    fixture.innerHTML = '<button>Target</button>';
    selection.setPicking(true);
    click(fixture.firstElementChild!, { shiftKey: true });
    selection.destroy();
    expect(onBatchChange.mock.calls).toEqual([[true], [false]]);
    key('keyup', 'Shift');
    key('keydown', 'Escape');
    window.dispatchEvent(new Event('blur'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('anchors document and sticky targets with scroll offsets and fixed shadow descendants in the viewport', async () => {
    const { selection, fixture, onSelect } = await setup();
    fixture.style.height = '3000px';
    fixture.innerHTML =
      '<button>Document</button><button style="position:sticky;top:0">Sticky</button><div style="position:fixed;top:100px;left:100px"></div>';
    const host = fixture.children[2]!;
    const fixed = document.createElement('button');
    fixed.textContent = 'Fixed descendant';
    host.attachShadow({ mode: 'open' }).append(fixed);
    window.scrollTo(0, 200);
    await settle();
    expect(window.scrollY).toBeGreaterThan(0);
    selection.setPicking(true);
    for (const button of [fixture.children[0]!, fixture.children[1]!, fixed]) {
      click(button, { clientX: 120, clientY: 110 });
      const anchor = onSelect.mock.lastCall![0];
      expect(anchor.space).toBe(button === fixed ? 'viewport' : 'document');
      expect(anchor.x).toBe(120 + (button === fixed ? 0 : window.scrollX));
      expect(anchor.y).toBe(110 + (button === fixed ? 0 : window.scrollY));
      expect(MarkerAnchorSchema.safeParse(anchor).success).toBe(true);
    }
    fixed.style.cssText = 'width:0;height:0;padding:0;border:0';
    click(fixed, { clientX: 100, clientY: 100 });
    expect(onSelect.mock.lastCall![0]).toMatchObject({ ratioX: 1, ratioY: 1 });
  });

  it('returns live safe rectangles and null for missing, ambiguous, and destroyed targets', async () => {
    const { selection, fixture, createSelection } = await setup();
    fixture.innerHTML = '<button>Original</button>';
    const button = fixture.firstElementChild!;
    selection.select(button);
    const target = selection.getTargets()[0]!;
    expect(selection.getRect(target)).toEqual(target.rect);
    fixture.style.transform = 'translate(25px, 35px)';
    expect(selection.getRect(target)).toEqual({
      ...target.rect,
      x: target.rect.x + 25,
      y: target.rect.y + 35,
    });
    button.replaceWith(button.cloneNode(true));
    expect(selection.getRect(target)).toBeNull();
    const restored = createSelection({ onChange: vi.fn() });
    selections.push(restored);
    expect(restored.getRect(target)).not.toBeNull();
    fixture.append(button.cloneNode(true));
    expect(
      restored.getRect({ ...target, id: crypto.randomUUID(), selector: `#${fixture.id} button` }),
    ).toBeNull();
    expect(restored.getRect({ ...target, id: crypto.randomUUID(), text: 'Mismatch' })).toBeNull();
    restored.destroy();
    expect(restored.getRect(target)).toBeNull();
  });
});
