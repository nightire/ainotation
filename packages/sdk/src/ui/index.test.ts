import type { Annotation } from '@ainotation/schema';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import { emptyViewState, type InspectorAction, type InspectorViewState } from '../core/types';
import { InspectorShell, registerInspectorShell } from './index';

const annotation: Annotation = {
  id: '11111111-1111-4111-8111-111111111111',
  comment: 'Keep <button> visible',
  createdAt: '2026-09-09T10:00:00.000Z',
  updatedAt: '2026-09-09T10:00:00.000Z',
  page: {
    url: 'http://localhost:5173/',
    title: 'Test',
    viewport: { width: 320, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  },
  targets: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      selector: '#submit',
      shadowHosts: [],
      tagName: 'button',
      text: 'Submit',
      attributes: {},
      styles: {},
      rect: { x: 0, y: 0, width: 80, height: 32 },
    },
  ],
  status: 'acknowledged',
  replies: [
    {
      id: '33333333-3333-4333-8333-333333333333',
      role: 'agent',
      message: '<img src=x onerror=alert(1)>',
      createdAt: '2026-09-09T10:01:00.000Z',
    },
    {
      id: '77777777-7777-4777-8777-777777777777',
      role: 'human',
      message: 'Stored human message that must stay out of the UI',
      createdAt: '2026-09-09T10:02:00.000Z',
    },
  ],
};

const secondAnnotation: Annotation = {
  ...annotation,
  id: '55555555-5555-4555-8555-555555555555',
  comment: 'Increase the order summary spacing',
  targets: [
    {
      ...annotation.targets[0]!,
      id: '66666666-6666-4666-8666-666666666666',
      selector: '#order-summary',
      tagName: 'aside',
      text: 'Order summary',
    },
  ],
  status: 'resolved',
  replies: [],
};

const shells: InspectorShell[] = [];

afterEach(() => {
  for (const shell of shells.splice(0)) shell.remove();
  vi.restoreAllMocks();
});

async function mount(overrides: Partial<InspectorViewState> = {}, expanded = true) {
  registerInspectorShell();
  const shell = document.createElement('ainotation-inspector-shell');
  if (expanded) shell.expanded = true;
  shell.view = {
    ...emptyViewState(),
    storage: 'ready',
    picking: expanded,
    selected: annotation.targets,
    document: {
      schemaVersion: 1,
      id: '44444444-4444-4444-8444-444444444444',
      url: annotation.page.url,
      createdAt: annotation.createdAt,
      annotations: structuredClone([annotation, secondAnnotation]),
    },
    ...overrides,
  };
  shells.push(shell);
  document.body.append(shell);
  await shell.updateComplete;
  return shell;
}

function control<T extends HTMLElement>(shell: InspectorShell, selector: string): T {
  const element = shell.shadowRoot?.querySelector<T>(selector);
  if (!element) throw new Error(`Missing control: ${selector}`);
  return element;
}

async function input(shell: InspectorShell, element: HTMLInputElement, value: string) {
  element.value = value;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  await shell.updateComplete;
}

function actionsFrom(shell: InspectorShell) {
  const actions: InspectorAction[] = [];
  shell.addEventListener('ainotation-action', (event) =>
    actions.push((event as CustomEvent<InspectorAction>).detail),
  );
  return actions;
}

async function openSettings(shell: InspectorShell) {
  control<HTMLButtonElement>(shell, '[aria-label="Settings"]').click();
  await shell.updateComplete;
}

// Synthetic gestures exercise handlers; actual mouse/touch capture belongs in E2E tests.
function pointer(target: Element, type: string, clientX: number, clientY: number) {
  const event = new PointerEvent(type, {
    bubbles: true,
    composed: true,
    cancelable: true,
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
    buttons: type === 'pointerup' ? 0 : 1,
    clientX,
    clientY,
  });
  target.dispatchEvent(event);
  return event;
}

describe('Inspector shell', () => {
  it('switches toolbar and Settings colors through an accessible theme control', async () => {
    const shell = await mount();
    const actions = actionsFrom(shell);
    await openSettings(shell);
    const button = control<HTMLButtonElement>(shell, '#inspector-theme');
    const settings = control<HTMLElement>(shell, '.settings');
    const toolbar = control<HTMLElement>(shell, '.toolbar');
    const light = getComputedStyle(settings).backgroundColor;
    expect(button.getAttribute('aria-label')).toBe('Theme: Light');
    button.click();
    expect(actions).toEqual([{ type: 'set-theme', value: 'dark' }]);
    shell.view = { ...shell.view, theme: 'dark' };
    await shell.updateComplete;
    expect(shell.dataset.theme).toBe('dark');
    expect(getComputedStyle(shell).colorScheme).toBe('dark');
    expect(getComputedStyle(settings).backgroundColor).not.toBe(light);
    expect(getComputedStyle(settings).backgroundColor).toBe(
      getComputedStyle(toolbar).backgroundColor,
    );
    expect(button.getAttribute('aria-label')).toBe('Theme: Dark');
    expect(button.getBoundingClientRect().height).toBe(28);
    button.click();
    expect(actions.at(-1)).toEqual({ type: 'set-theme', value: 'light' });
  });
  it('restores a shared position but does not overwrite a newer user movement', async () => {
    const shell = await mount({}, false);
    const position = { left: 20, top: 100, opensLeft: false };
    shell.restorePosition({ ...position, top: window.innerHeight + 100 });
    expect(shell.getPosition()?.opensLeft).toBe(false);
    shell.restorePosition(position);
    expect(shell.getPosition()).toEqual(position);
    control(shell, '.launcher').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
    );
    const moved = shell.getPosition();
    expect(moved?.left).toBe(30);
    shell.restorePosition(position);
    expect(shell.getPosition()).toEqual(moved);
  });
  it('cycles all four output levels with matching dots and no dropdown', async () => {
    const shell = await mount();
    const actions = actionsFrom(shell);
    await openSettings(shell);
    const button = control<HTMLButtonElement>(shell, '#output-detail');
    expect(button.getAttribute('data-level')).toBe('standard');
    expect(button.matches('select, [role="combobox"]')).toBe(false);
    const before = structuredClone(shell.view.document);
    for (const [value, index] of [
      ['detailed', 2],
      ['forensic', 3],
      ['compact', 0],
      ['standard', 1],
    ] as const) {
      button.click();
      expect(actions.at(-1)).toEqual({ type: 'set-output-detail', value });
      shell.view = { ...shell.view, outputDetail: value };
      await shell.updateComplete;
      const dots = [...button.querySelectorAll('.detail-dot')];
      expect(dots).toHaveLength(4);
      expect(dots.filter((dot) => dot.classList.contains('active'))).toEqual([dots[index]]);
      expect(button.getAttribute('data-level')).toBe(value);
      expect(shell.view.document).toEqual(before);
    }
  });
  it('renders exactly five ordered toolbar actions and disables clear when empty or busy', async () => {
    const shell = await mount();
    const buttons = [...shell.shadowRoot!.querySelectorAll<HTMLButtonElement>('header button')];
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Copy feedback',
      'Export JSON',
      'Clear all annotations',
      'Settings',
      'Close inspector',
    ]);
    expect(shell.getBoundingClientRect().height).toBe(52);
    expect(control(shell, '.separator').nextElementSibling).toBe(buttons[4]);
    const actions = actionsFrom(shell);
    buttons[2]!.click();
    expect(actions).toEqual([{ type: 'clear-all' }]);
    shell.view = {
      ...shell.view,
      selected: [],
      document: { ...shell.view.document!, annotations: [] },
    };
    await shell.updateComplete;
    expect(buttons[2]!.disabled).toBe(true);
    shell.view = { ...shell.view, draft: 'Draft only' };
    await shell.updateComplete;
    expect(buttons[2]!.disabled).toBe(false);
    shell.view = { ...shell.view, saving: true };
    await shell.updateComplete;
    expect(buttons[2]!.disabled).toBe(true);
  });

  it('dismisses settings with Escape or an outside pointer without discarding inputs or closing Inspector', async () => {
    const shell = await mount();
    const actions = actionsFrom(shell);
    await openSettings(shell);
    const token = control<HTMLInputElement>(shell, '[type="password"]');
    await input(shell, token, 'Unsubmitted');
    const escape = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    token.dispatchEvent(escape);
    await shell.updateComplete;
    expect(escape.defaultPrevented).toBe(true);
    expect(shell.settingsOpen).toBe(false);
    expect(shell.shadowRoot!.activeElement).toBe(control(shell, '[aria-label="Settings"]'));
    await openSettings(shell);
    expect(token.value).toBe('Unsubmitted');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    await shell.updateComplete;
    expect(shell.settingsOpen).toBe(false);
    expect(shell.expanded).toBe(true);
    expect(actions).toEqual([]);
  });

  it('toggles with Option/Alt+Shift+KeyA globally and from the token without changing text', async () => {
    const shell = await mount({ draft: 'Keep my draft' }, false);
    const actions = actionsFrom(shell);
    const shortcut = (target: EventTarget, key: string) => {
      const event = new KeyboardEvent('keydown', {
        key,
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
        modifierAltGraph: key === '\u00c5',
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      target.dispatchEvent(event);
      return event;
    };
    // Option+Shift+A can produce a different character on macOS.
    expect(shortcut(document, '\u00c5').defaultPrevented).toBe(true);
    await shell.updateComplete;
    expect(shell.expanded).toBe(true);
    expect(actions).toEqual([{ type: 'set-picking', value: true }]);
    await openSettings(shell);
    const token = control<HTMLInputElement>(shell, '[type="password"]');
    await input(shell, token, 'Keep my token');
    token.focus();
    expect(shortcut(token, 'A').defaultPrevented).toBe(true);
    await shell.updateComplete;
    expect(shell.expanded).toBe(false);
    expect(actions.at(-1)).toEqual({ type: 'set-picking', value: false });
    expect(token.value).toBe('Keep my token');
    expect(shell.view.draft).toBe('Keep my draft');
    expect(control(shell, '.launcher').getAttribute('aria-keyshortcuts')).toBe('Alt+Shift+A');
  });

  it('ignores repeated, composing, modified and already handled shortcuts', async () => {
    const shell = await mount({}, false);
    const actions = actionsFrom(shell);
    const variants: KeyboardEventInit[] = [
      { repeat: true },
      { isComposing: true },
      { ctrlKey: true },
      { metaKey: true },
      { altKey: false },
      { shiftKey: false },
      { code: 'KeyB', key: 'A' },
    ];
    for (const variant of variants) {
      const event = new KeyboardEvent('keydown', {
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        ...variant,
      });
      document.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    const handled = new KeyboardEvent('keydown', {
      code: 'KeyA',
      altKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    handled.preventDefault();
    document.dispatchEvent(handled);
    await shell.updateComplete;
    expect(shell.expanded).toBe(false);
    expect(actions).toEqual([]);
  });

  it('does not open while loading and removes its shortcut listener on disconnect', async () => {
    const shell = await mount({ storage: 'loading' }, false);
    const actions = actionsFrom(shell);
    const press = () =>
      document.dispatchEvent(
        new KeyboardEvent('keydown', {
          code: 'KeyA',
          altKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    press();
    await shell.updateComplete;
    expect(shell.expanded).toBe(false);
    shell.view = { ...shell.view, storage: 'ready' };
    await shell.updateComplete;
    press();
    await shell.updateComplete;
    expect(shell.expanded).toBe(true);
    shell.remove();
    press();
    expect(actions).toHaveLength(1);
    document.body.append(shell);
    await shell.updateComplete;
    press();
    await shell.updateComplete;
    expect(shell.expanded).toBe(false);
    expect(actions).toHaveLength(2);
  });

  it('targets the focused inspector when multiple instances share a document', async () => {
    const first = await mount({}, false);
    const second = await mount({}, false);
    const actions = actionsFrom(first);
    control(second, '.launcher').dispatchEvent(
      new KeyboardEvent('keydown', {
        code: 'KeyA',
        altKey: true,
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    await second.updateComplete;
    expect(first.expanded).toBe(false);
    expect(second.expanded).toBe(true);
    expect(actions).toEqual([]);
  });

  it('defaults to a 48px circular launcher without an invisible panel hit area', async () => {
    const shell = await mount({}, false);
    const launcher = control<HTMLButtonElement>(shell, '.launcher');
    const panel = control<HTMLElement>(shell, '.toolbar');
    expect(shell.expanded).toBe(false);
    expect(shell.hasAttribute('expanded')).toBe(false);
    expect(launcher.textContent?.trim()).toBe('A');
    expect(launcher.getAttribute('aria-label')).toBe('Open inspector');
    expect(launcher.getAttribute('aria-expanded')).toBe('false');
    expect(launcher.getAttribute('aria-controls')).toBe(panel.id);
    expect(launcher.hidden).toBe(false);
    expect(getComputedStyle(launcher).borderRadius).toBe('50%');
    expect(panel.hidden).toBe(true);
    expect(panel.getClientRects()).toHaveLength(0);
    const rect = shell.getBoundingClientRect();
    expect(rect.width).toBe(48);
    expect(rect.height).toBe(48);
    expect(launcher.getBoundingClientRect().toJSON()).toEqual(rect.toJSON());
    expect(document.elementFromPoint(rect.left + 24, rect.top + 24)).toBe(shell);
    expect(document.elementFromPoint(rect.left - 100, rect.top + 24)).not.toBe(shell);
    expect(document.elementFromPoint(rect.left + 24, rect.top - 100)).not.toBe(shell);
  });

  it.each(['Close inspector'])(
    '%s minimizes without destruction and preserves the draft, selection, and editor',
    async (label) => {
      const shell = await mount(
        { draft: 'Unfinished edit', editingId: annotation.id, editorOpen: true, saving: true },
        false,
      );
      const view = shell.view;
      const original = structuredClone(view);
      const actions = actionsFrom(shell);
      const close = vi.fn();
      shell.addEventListener('ainotation-close', close);
      const launcher = control<HTMLButtonElement>(shell, '.launcher');
      launcher.click();
      await shell.updateComplete;
      expect(shell.expanded).toBe(true);
      expect(shell.hasAttribute('expanded')).toBe(true);
      expect(launcher.hidden).toBe(true);
      expect(control<HTMLElement>(shell, '.toolbar').hidden).toBe(false);
      expect(shell.shadowRoot?.activeElement).toBe(
        control(shell, '[aria-label="Close inspector"]'),
      );
      expect(actions).toEqual([{ type: 'set-picking', value: true }]);

      await openSettings(shell);
      const settings = control<HTMLElement>(shell, '.settings');
      const endpoint = control<HTMLInputElement>(shell, '[type="url"]');
      const token = control<HTMLInputElement>(shell, '[type="password"]');
      await input(shell, endpoint, 'http://127.0.0.1:5555');
      await input(shell, token, 'Unsubmitted token');
      control<HTMLButtonElement>(shell, `[aria-label="${label}"]`).click();
      await shell.updateComplete;
      expect(shell.expanded).toBe(false);
      expect(control<HTMLElement>(shell, '.toolbar').hidden).toBe(true);
      expect(shell.getBoundingClientRect().width).toBe(48);
      expect(shell.getBoundingClientRect().height).toBe(48);
      expect(shell.shadowRoot?.activeElement).toBe(launcher);
      expect(launcher.getAttribute('aria-expanded')).toBe('false');
      expect(close).not.toHaveBeenCalled();
      expect(shell.isConnected).toBe(true);
      expect(actions).toEqual([
        { type: 'set-picking', value: true },
        { type: 'set-picking', value: false },
      ]);

      launcher.click();
      await shell.updateComplete;
      expect(actions.at(-1)).toEqual({ type: 'set-picking', value: true });
      expect(control(shell, '[type="password"]')).toBe(token);
      expect(token.value).toBe('Unsubmitted token');
      expect(endpoint.value).toBe('http://127.0.0.1:5555');
      expect(settings.hidden).toBe(true);
      expect(shell.view).toBe(view);
      expect(shell.view).toEqual(original);
      expect(shell.shadowRoot?.querySelector('textarea')).toBeNull();
    },
  );

  it('waits for initialization so opening can immediately enter selection', async () => {
    const shell = await mount({ storage: 'loading' }, false);
    const launcher = control<HTMLButtonElement>(shell, '.launcher');
    const actions = actionsFrom(shell);
    expect(launcher.disabled).toBe(true);
    launcher.click();
    await shell.updateComplete;
    expect(shell.expanded).toBe(false);
    expect(actions).toEqual([]);
    shell.view = { ...shell.view, storage: 'ready' };
    await shell.updateComplete;
    launcher.click();
    await shell.updateComplete;
    expect(shell.expanded).toBe(true);
    expect(actions).toEqual([{ type: 'set-picking', value: true }]);
  });

  it.each([false, true])('moves by keyboard without changing expanded=%s', async (expanded) => {
    const shell = await mount({}, expanded);
    const actions = actionsFrom(shell);
    const handle = control<HTMLElement>(shell, expanded ? 'header' : '.launcher');
    const before = shell.getBoundingClientRect();
    handle.focus();
    const left = new KeyboardEvent('keydown', {
      key: 'ArrowLeft',
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    handle.dispatchEvent(left);
    handle.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
        composed: true,
        cancelable: true,
      }),
    );
    const after = shell.getBoundingClientRect();
    expect(after.left).toBe(before.left - 9);
    expect(after.top).toBe(before.top);
    expect(left.defaultPrevented).toBe(true);
    expect(shell.shadowRoot?.activeElement).toBe(handle);
    expect(shell.expanded).toBe(expanded);
    expect(actions).toEqual([]);
  });

  it('keeps header controls and credential text selection out of dragging', async () => {
    const shell = await mount();
    await openSettings(shell);
    const header = control<HTMLElement>(shell, 'header');
    const capture = vi.spyOn(header, 'setPointerCapture').mockImplementation(() => {});
    const before = shell.getBoundingClientRect().toJSON();
    const actions = actionsFrom(shell);
    for (const button of header.querySelectorAll('button')) {
      const down = pointer(button.querySelector('svg')!, 'pointerdown', 100, 100);
      pointer(shell, 'pointermove', 60, 100);
      pointer(shell, 'pointerup', 60, 100);
      const key = new KeyboardEvent('keydown', {
        key: 'ArrowLeft',
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      button.dispatchEvent(key);
      expect(down.defaultPrevented).toBe(false);
      expect(key.defaultPrevented).toBe(false);
    }
    const token = control<HTMLInputElement>(shell, '[type="password"]');
    await input(shell, token, 'Select this text');
    token.focus();
    token.setSelectionRange(0, 6);
    expect(pointer(token, 'pointerdown', 100, 100).defaultPrevented).toBe(false);
    expect(pointer(token, 'pointermove', 60, 100).defaultPrevented).toBe(false);
    pointer(token, 'pointerup', 60, 100);
    expect([token.selectionStart, token.selectionEnd]).toEqual([0, 6]);
    expect(capture).not.toHaveBeenCalled();
    expect(shell.getBoundingClientRect().toJSON()).toEqual(before);
    expect(actions).toEqual([]);
  });

  it.each([4, 5])(
    'applies the 5px drag threshold for a %spx launcher gesture',
    async (distance) => {
      const shell = await mount({}, false);
      const launcher = control<HTMLButtonElement>(shell, '.launcher');
      const capture = vi.spyOn(launcher, 'setPointerCapture').mockImplementation(() => {});
      const actions = actionsFrom(shell);
      const before = shell.getBoundingClientRect();
      pointer(launcher, 'pointerdown', before.left + 24, before.top + 24);
      const move = pointer(launcher, 'pointermove', before.left + 24 - distance, before.top + 24);
      pointer(launcher, 'pointerup', before.left + 24 - distance, before.top + 24);
      expect(capture).toHaveBeenCalledWith(1);
      expect(move.defaultPrevented).toBe(distance >= 5);
      expect(shell.getBoundingClientRect().left).toBe(before.left - (distance >= 5 ? distance : 0));
      const click = new MouseEvent('click', {
        detail: 1,
        bubbles: true,
        composed: true,
        cancelable: true,
      });
      launcher.dispatchEvent(click);
      await shell.updateComplete;
      expect(click.defaultPrevented).toBe(distance >= 5);
      expect(shell.expanded).toBe(distance < 5);
      expect(actions).toEqual(distance < 5 ? [{ type: 'set-picking', value: true }] : []);
      if (distance >= 5) {
        launcher.click();
        await shell.updateComplete;
        expect(shell.expanded).toBe(true);
        expect(actions).toEqual([{ type: 'set-picking', value: true }]);
      }
    },
  );

  it('moves the trigger with the toolbar and reopens without a position jump', async () => {
    const shell = await mount({}, false);
    const launcher = control<HTMLButtonElement>(shell, '.launcher');
    const launcherRect = shell.getBoundingClientRect().toJSON();
    launcher.click();
    await shell.updateComplete;
    const header = control<HTMLElement>(shell, 'header');
    vi.spyOn(header, 'setPointerCapture').mockImplementation(() => {});
    const before = shell.getBoundingClientRect();
    pointer(header, 'pointerdown', before.left + 24, before.top + 24);
    pointer(header, 'pointermove', before.left + 4, before.top + 24);
    pointer(header, 'pointerup', before.left + 4, before.top + 24);
    const panelRect = shell.getBoundingClientRect().toJSON();
    expect(panelRect.left).toBe(before.left - 20);
    control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
    await shell.updateComplete;
    expect(shell.getBoundingClientRect().left).toBe(launcherRect.left - 20);
    expect(shell.getBoundingClientRect().bottom).toBe(panelRect.bottom);
    launcher.click();
    await shell.updateComplete;
    expect(shell.getBoundingClientRect().toJSON()).toEqual(panelRect);
  });

  it('keeps the left anchor after dragging a right-opening toolbar into the middle', async () => {
    const shell = await mount({}, false);
    shell.style.left = '20px';
    shell.style.top = '100px';
    shell.style.right = 'auto';
    shell.style.bottom = 'auto';
    const launcher = control<HTMLButtonElement>(shell, '.launcher');
    launcher.click();
    await shell.updateComplete;
    const header = control<HTMLElement>(shell, 'header');
    // Keyboard movement shares the same positioning path as pointer dragging.
    for (let i = 0; i < 22; i++)
      header.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
      );
    const toolbar = shell.getBoundingClientRect().toJSON();
    expect(toolbar.left).toBe(Math.min(240, document.documentElement.clientWidth - toolbar.width));
    control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
    await shell.updateComplete;
    expect(shell.getBoundingClientRect().left).toBe(toolbar.left);
    expect(shell.getBoundingClientRect().bottom).toBe(toolbar.bottom);
    launcher.click();
    await shell.updateComplete;
    expect(shell.getBoundingClientRect().toJSON()).toEqual(toolbar);
  });

  it.each(['left', 'right'] as const)(
    'follows the moved trigger at the %s edge on subsequent openings',
    async (edge) => {
      const shell = await mount({}, false);
      const launcher = control<HTMLButtonElement>(shell, '.launcher');
      launcher.click();
      await shell.updateComplete;
      control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
      await shell.updateComplete;
      const left = edge === 'left' ? 12 : window.innerWidth - 60;
      shell.style.left = `${left}px`;
      shell.style.top = '100px';
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
      const trigger = shell.getBoundingClientRect();
      launcher.click();
      await shell.updateComplete;
      const toolbar = shell.getBoundingClientRect();
      if (edge === 'left') expect(toolbar.left).toBe(trigger.left);
      else expect(toolbar.right).toBe(trigger.right);
      expect(toolbar.bottom).toBe(trigger.bottom);
      expect(toolbar.left).toBeGreaterThanOrEqual(0);
      expect(toolbar.right).toBeLessThanOrEqual(window.innerWidth);
      control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
      await shell.updateComplete;
      expect(shell.getBoundingClientRect().toJSON()).toEqual(trigger.toJSON());
    },
  );

  it.each([false, true])(
    'clamps expanded=%s back into the viewport on resize',
    async (expanded) => {
      const shell = await mount({}, expanded);
      // Flush the initial observer/frame so only the resize can request the next clamp.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      for (const position of [-100, Math.max(window.innerWidth, window.innerHeight) + 100]) {
        shell.style.left = `${position}px`;
        shell.style.top = `${position}px`;
        window.dispatchEvent(new Event('resize'));
        await vi.waitFor(() => {
          const rect = shell.getBoundingClientRect();
          expect(rect.left).toBeGreaterThanOrEqual(0);
          expect(rect.top).toBeGreaterThanOrEqual(0);
          expect(rect.right).toBeLessThanOrEqual(document.documentElement.clientWidth);
          expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
        });
      }
    },
  );

  it('releases an active gesture and removes movement listeners on disconnect', async () => {
    const shell = await mount({}, false);
    const launcher = control<HTMLButtonElement>(shell, '.launcher');
    vi.spyOn(launcher, 'setPointerCapture').mockImplementation(() => {});
    vi.spyOn(launcher, 'hasPointerCapture').mockReturnValue(true);
    const release = vi.spyOn(launcher, 'releasePointerCapture').mockImplementation(() => {});
    const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame');
    pointer(launcher, 'pointerdown', 100, 100);
    pointer(launcher, 'pointermove', 80, 100);
    shell.remove();
    expect(release).toHaveBeenCalledExactlyOnceWith(1);
    expect(cancelFrame).toHaveBeenCalled();
    const style = shell.style.cssText;
    pointer(launcher, 'pointermove', 40, 100);
    pointer(launcher, 'pointerup', 40, 100);
    expect(shell.style.cssText).toBe(style);
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame');
    window.dispatchEvent(new Event('resize'));
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it('emits native batch actions without local storage and displays footer notices', async () => {
    const shell = await mount({ storage: 'unavailable', syncing: true, message: 'Copy complete' });
    const events: CustomEvent<InspectorAction>[] = [];
    shell.addEventListener('ainotation-action', (event) =>
      events.push(event as CustomEvent<InspectorAction>),
    );
    const buttons = [
      ...shell.shadowRoot!.querySelectorAll<HTMLButtonElement>('header button'),
    ].slice(0, 2);
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual([
      'Copy feedback',
      'Export JSON',
    ]);
    for (const button of buttons) {
      expect(button.disabled).toBe(false);
      button.click();
    }
    expect(events.map((event) => event.detail)).toEqual([{ type: 'copy' }, { type: 'export' }]);
    expect(events[0]).toBeInstanceOf(CustomEvent);
    expect(events[0]?.bubbles).toBe(true);
    expect(events[0]?.composed).toBe(true);
    const notices = control(shell, '.notices');
    expect(notices.textContent).toContain(
      'Local storage unavailable. Changes are not saved locally.',
    );
    expect(notices.textContent).toContain('Syncing feedback...');
    expect(notices.textContent).toContain('Copy complete');
    shell.view = { ...shell.view, storage: 'loading' };
    await shell.updateComplete;
    expect(notices.textContent).toContain('Loading local feedback...');
    expect(control<HTMLButtonElement>(shell, '.connection-form button').disabled).toBe(true);
  });

  it.each(['offline', 'connected'] as const)(
    'renders no annotation count, selection or editing UI when %s',
    async (connection) => {
      const shell = await mount({
        connection,
        draft: 'External popover draft',
        editingId: annotation.id,
        editorOpen: true,
        saving: true,
        availability: {
          [annotation.targets[0]!.id]: 'missing',
          [secondAnnotation.targets[0]!.id]: 'ambiguous',
        },
      });
      const originalView = shell.view;
      const original = structuredClone(originalView);
      const actions: InspectorAction[] = [];
      shell.addEventListener('ainotation-action', (event) =>
        actions.push((event as CustomEvent<InspectorAction>).detail),
      );

      for (const status of ['pending', 'acknowledged', 'resolved', 'dismissed'] as const) {
        const nextView = structuredClone(original);
        if (!nextView.document) throw new Error('Missing fixture document');
        nextView.document.annotations.reverse();
        for (const item of nextView.document.annotations) item.status = status;
        const expected = structuredClone(nextView);
        shell.view = nextView;
        await shell.updateComplete;

        const root = shell.shadowRoot!;
        expect(root.querySelector('[aria-label^="Annotations ("]')).toBeNull();
        expect(root.querySelector('.body > p')).toBeNull();
        expect(root.querySelectorAll('textarea')).toHaveLength(0);
        expect(root.querySelectorAll('input[type="password"]')).toHaveLength(1);
        expect(
          root.querySelector('article, ol, ul, [role="list"], [type="checkbox"], [aria-pressed]'),
        ).toBeNull();
        expect(
          root.querySelector('h3, .draft, .draft-actions, .feedback-list, .targets'),
        ).toBeNull();
        expect(root.textContent).not.toMatch(
          /Select element|Select parent|Clear selection|Remove target|Add feedback|Save changes|Cancel edit|Pause|missing|ambiguous/i,
        );
        expect(root.textContent).not.toContain(nextView.draft);
        for (const item of nextView.document.annotations) {
          expect(root.innerHTML).not.toContain(item.id);
          expect(root.textContent).not.toContain(item.comment);
          for (const target of item.targets) {
            expect(root.textContent).not.toContain(target.selector);
            expect(root.textContent).not.toContain(target.text);
          }
        }
        expect(root.innerHTML).not.toMatch(
          /reply|replies|reopen|pending|acknowledged|resolved|dismissed/i,
        );
        for (const reply of annotation.replies) {
          expect(root.textContent).not.toContain(reply.message);
          for (const element of root.querySelectorAll('*')) {
            for (const attribute of element.attributes) {
              expect(attribute.value).not.toContain(reply.message);
            }
          }
          for (const field of root.querySelectorAll<HTMLInputElement>('input')) {
            expect(field.value).not.toContain(reply.message);
          }
        }
        expect(root.querySelector('img')).toBeNull();
        control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
        await shell.updateComplete;
        expect(control<HTMLElement>(shell, '.toolbar').hidden).toBe(true);
        control<HTMLButtonElement>(shell, '[aria-label="Open inspector"]').click();
        await shell.updateComplete;
        expect(control<HTMLElement>(shell, '.toolbar').hidden).toBe(false);
        expect(shell.view).toBe(nextView);
        expect(nextView).toEqual(expected);
      }

      const beforeActions = structuredClone(shell.view);
      const footerButtons = [
        ...shell.shadowRoot!.querySelectorAll<HTMLButtonElement>('header button:nth-child(-n+2)'),
      ];
      expect(footerButtons.map((button) => button.getAttribute('aria-label'))).toEqual([
        'Copy feedback',
        'Export JSON',
      ]);
      for (const button of footerButtons) {
        expect(button.disabled).toBe(false);
        button.click();
      }
      expect(actions.slice(-2)).toEqual([{ type: 'copy' }, { type: 'export' }]);
      shell.requestUpdate();
      await shell.updateComplete;
      expect(shell.view).toEqual(beforeActions);
      expect(originalView).toEqual(original);
    },
  );

  it('keeps toolbar available and settings closed regardless of picking', async () => {
    const shell = await mount({ picking: true, draft: 'Fix spacing' });
    for (const picking of [true, false]) {
      shell.view = { ...shell.view, picking };
      await shell.updateComplete;
      expect(getComputedStyle(control<HTMLElement>(shell, '.toolbar')).display).not.toBe('none');
      expect(control<HTMLElement>(shell, '.settings').hidden).toBe(true);
      expect(shell.shadowRoot?.querySelector('textarea')).toBeNull();
    }
  });

  it('omits counts and disables batch actions only without a document', async () => {
    const shell = await mount();
    const document = shell.view.document!;
    const actions = actionsFrom(shell);
    for (const count of [0, 1, 2]) {
      shell.view = {
        ...shell.view,
        document: { ...document, annotations: document.annotations.slice(0, count) },
      };
      await shell.updateComplete;
      expect(shell.shadowRoot?.querySelector('[aria-label^="Annotations ("]')).toBeNull();
      for (const button of shell.shadowRoot!.querySelectorAll<HTMLButtonElement>(
        'header button:nth-child(-n+2)',
      )) {
        expect(button.disabled).toBe(false);
      }
    }
    shell.view = { ...shell.view, document: null };
    await shell.updateComplete;
    expect(shell.shadowRoot?.querySelector('.body > p')).toBeNull();
    for (const button of shell.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      'header button:nth-child(-n+2)',
    )) {
      expect(button.disabled).toBe(true);
      button.click();
    }
    expect(actions).toEqual([]);
  });

  it('keeps tokens local and reports server transport connection', async () => {
    const shell = await mount({ document: null });
    await openSettings(shell);
    const endpoint = control<HTMLInputElement>(shell, '[type="url"]');
    const token = control<HTMLInputElement>(shell, '[type="password"]');
    expect(endpoint.value).toBe(shell.view.endpoint);
    await input(shell, endpoint, ' http://127.0.0.1:5555 ');
    await input(shell, token, ' secret-token ');
    const actions: InspectorAction[] = [];
    shell.addEventListener('ainotation-action', (event) =>
      actions.push((event as CustomEvent<InspectorAction>).detail),
    );
    control<HTMLFormElement>(shell, '.connection-form').requestSubmit();
    expect(actions).toEqual([
      { type: 'connect', endpoint: 'http://127.0.0.1:5555', token: 'secret-token' },
    ]);
    await shell.updateComplete;
    expect(token.value).toBe('');
    expect(JSON.stringify(shell.view)).not.toContain('secret-token');
    shell.view = { ...shell.view, connection: 'connected' };
    await shell.updateComplete;
    expect(control(shell, '.connection-status').textContent).toBe('Connected');
    expect(shell.shadowRoot?.textContent).not.toContain('Agent connected');
    const disconnect = [...shell.shadowRoot!.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Disconnect',
    );
    disconnect?.click();
    expect(actions[1]).toEqual({ type: 'disconnect' });
    const close: Event[] = [];
    shell.addEventListener('ainotation-close', (event) => close.push(event));
    control<HTMLButtonElement>(shell, '[aria-label="Close inspector"]').click();
    await shell.updateComplete;
    expect(actions[2]).toEqual({ type: 'set-picking', value: false });
    expect(shell.expanded).toBe(false);
    expect(close).toHaveLength(0);
  });

  it('fits a narrow toolbar and keeps settings within the viewport above or below it', async () => {
    const shell = await mount();
    await openSettings(shell);
    shell.style.width = '240px';
    await shell.updateComplete;
    const toolbar = control<HTMLElement>(shell, '.toolbar');
    const settings = control<HTMLElement>(shell, '.settings');
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth);
    expect(settings.scrollWidth).toBeLessThanOrEqual(settings.clientWidth);
    expect(settings.getBoundingClientRect().bottom).toBeLessThan(shell.getBoundingClientRect().top);
    shell.style.top = '0px';
    shell.style.left = '0px';
    shell.requestUpdate();
    await shell.updateComplete;
    const rect = settings.getBoundingClientRect();
    expect(rect.top).toBeGreaterThan(shell.getBoundingClientRect().bottom);
    expect(rect.left).toBeGreaterThanOrEqual(0);
    expect(rect.right).toBeLessThanOrEqual(window.innerWidth);
    expect(rect.bottom).toBeLessThanOrEqual(window.innerHeight);
  });
});
