import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createAinotation, type Ainotation } from './index';
import type { DraftRecord } from './core/storage';
import type { InspectorAction } from './core/types';
import type { InspectorShell } from './ui';

const instances: Ainotation[] = [];
const fixtures: HTMLElement[] = [];
const databases: { db: IDBPDatabase; pageKeys: string[] }[] = [];

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
});

function action(shell: InspectorShell, detail: InspectorAction) {
  shell.dispatchEvent(
    new CustomEvent<InspectorAction>('ainotation-action', {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

function overlay(kind: 'selection' | 'markers') {
  return document.querySelector<HTMLElement>(`[data-ainotation-ui="${kind}"]`)!;
}

function select(button: HTMLButtonElement, shiftKey = false) {
  const rect = button.getBoundingClientRect();
  button.dispatchEvent(
    new MouseEvent('click', {
      clientX: Math.round(rect.x + rect.width / 2),
      clientY: Math.round(rect.y + rect.height / 2),
      shiftKey,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

async function selectMultiple(shell: InspectorShell, buttons: HTMLButtonElement[]) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
  );
  try {
    for (const button of buttons) select(button, true);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(false);
    expect(shell.view.marker).toBeNull();
  } finally {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  }
  await vi.waitFor(() => {
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.selected).toHaveLength(buttons.length);
  });
}

async function setup(options: Parameters<typeof createAinotation>[0] = {}) {
  const projectId = options.projectId ?? crypto.randomUUID();
  const instance = createAinotation({ ...options, projectId });
  instances.push(instance);
  const fixture = document.createElement('div');
  fixture.id = `fixture-${projectId}`;
  const buttons = ['First target', 'Second target'].map((text, index) => {
    const button = document.createElement('button');
    button.id = `target-${projectId}-${index}`;
    button.textContent = text;
    fixture.append(button);
    return button;
  });
  document.body.append(fixture);
  fixtures.push(fixture);
  await instance.mount();
  const shell = document.querySelector('ainotation-inspector-shell')!;
  await vi.waitFor(() => {
    expect(shell.view.storage).toBe('ready');
    expect(shell.expanded).toBe(false);
    expect(shell.view.picking).toBe(false);
    expect(shell.view.editorOpen).toBe(false);
    expect(getComputedStyle(overlay('markers')).display).toBe('none');
  });
  await shell.updateComplete;
  shell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
  await vi.waitFor(() => {
    expect(shell.expanded).toBe(true);
    expect(shell.view.picking).toBe(true);
    expect(getComputedStyle(overlay('markers')).display).toBe('block');
  });
  const db = await openDB('ainotation-feedback', 1);
  const originalUrl = location.href;
  const pageKeys = [JSON.stringify([projectId, originalUrl])];
  databases.push({ db, pageKeys });
  const read = (url = originalUrl): Promise<DraftRecord | undefined> =>
    db.get('pages', JSON.stringify([projectId, url]));
  return { instance, fixture, buttons, shell, read, projectId, pageKeys };
}

async function save(shell: InspectorShell, comment: string) {
  action(shell, { type: 'draft', value: comment });
  action(shell, { type: 'save' });
  await vi.waitFor(() => {
    expect(shell.view.document?.annotations.some((note) => note.comment === comment)).toBe(true);
    expect(shell.view).toMatchObject({
      selected: [],
      draft: '',
      editingId: null,
      editorOpen: false,
      marker: null,
      saving: false,
      picking: true,
    });
    expect(shell.view.message).toBe('Feedback saved');
    expect(
      overlay('markers').shadowRoot!.querySelector('[aria-label="New annotation"]'),
    ).toBeNull();
    expect(overlay('markers').shadowRoot!.querySelector('[role="dialog"]')).toBeNull();
  });
}

afterEach(async () => {
  for (const instance of instances.splice(0)) instance.destroy();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  vi.restoreAllMocks();
  for (const { db, pageKeys } of databases.splice(0)) {
    try {
      for (const key of pageKeys) await db.delete('pages', key);
    } finally {
      db.close();
    }
  }
});

describe('mounted feedback runtime', () => {
  it('clears persisted style drafts so remount cannot resurrect a cleared preview', async () => {
    const { instance, shell, buttons, read, projectId } = await setup({ mcp: false });
    buttons[0]!.style.padding = '8px';
    select(buttons[0]!);
    await save(shell, 'Clear this marker');
    action(shell, { type: 'edit', id: shell.view.document!.annotations[0]!.id });
    action(shell, { type: 'style-change', property: 'padding-top', value: '24px', linked: false });
    await vi.waitFor(async () => expect((await read())?.styleDrafts).toHaveLength(1));
    action(shell, { type: 'clear-all' });
    await vi.waitFor(() => expect(shell.view.message).toBe('All annotations on this page cleared'));
    expect(buttons[0]!.style.paddingTop).toBe('8px');
    instance.destroy();
    const restored = createAinotation({ projectId, mcp: false });
    instances.push(restored);
    await restored.mount();
    const next = document.querySelector('ainotation-inspector-shell')!;
    await vi.waitFor(() => expect(next.view.storage).toBe('ready'));
    expect(next.view.document!.annotations).toEqual([]);
    expect(next.view.styleEditor.globalCount).toBe(0);
    expect(buttons[0]!.style.paddingTop).toBe('8px');
  });

  it('allows navigation among retained targets at the limit while rejecting a twenty-first target', async () => {
    const { shell, buttons, fixture } = await setup({ mcp: false });
    let parent: HTMLElement = fixture;
    for (let index = 0; index < 20; index++) {
      const wrapper = document.createElement('section');
      wrapper.id = `navigation-limit-${index}`;
      wrapper.style.padding = '1px';
      parent.append(wrapper);
      parent = wrapper;
    }
    parent.append(buttons[0]!);
    buttons[0]!.style.padding = '8px';
    select(buttons[0]!);
    const ids: string[] = [];
    for (let index = 0; index < 20; index++) {
      const id = shell.view.selected[0]!.id;
      ids.push(id);
      action(shell, {
        type: 'style-change',
        property: 'padding-top',
        value: '16px',
        linked: false,
      });
      if (index < 19) action(shell, { type: 'navigate-target', id, direction: 'parent' });
    }
    expect(shell.view.styleEditor.count).toBe(20);
    action(shell, { type: 'navigate-target', id: ids[19]!, direction: 'parent' });
    expect(shell.view.selected[0]!.id).toBe(ids[19]);
    action(shell, { type: 'navigate-target', id: ids[19]!, direction: 'back' });
    expect(shell.view.selected[0]!.id).toBe(ids[18]);
    action(shell, { type: 'navigate-target', id: ids[18]!, direction: 'parent' });
    expect(shell.view.selected[0]!.id).toBe(ids[19]);
    await save(shell, 'Twenty retained targets');
    expect(shell.view.document!.annotations[0]!.targets).toHaveLength(20);
  });

  it.each(['legacy', 'invalid', 'changed-targets'] as const)(
    'falls back to the full target list for %s navigation metadata',
    async (kind) => {
      const { instance, shell, buttons, read, projectId } = await setup({ mcp: false });
      select(buttons[0]!);
      const child = shell.view.selected[0]!;
      action(shell, {
        type: 'style-change',
        property: 'padding-top',
        value: '16px',
        linked: false,
      });
      action(shell, { type: 'navigate-target', id: child.id, direction: 'parent' });
      await save(shell, 'Navigation fallback');
      const note = shell.view.document!.annotations[0]!;
      await vi.waitFor(async () =>
        expect((await read())?.editorViews?.[note.id]?.navigation).toBeDefined(),
      );
      instance.destroy();
      const database = databases.at(-1)!;
      const record = (await database.db.get('pages', database.pageKeys[0]!)) as DraftRecord;
      const presentation = record.editorViews![note.id]!;
      if (kind === 'legacy') delete presentation.navigation;
      else if (kind === 'invalid')
        presentation.navigation!.slots[0]!.history = [presentation.navigation!.slots[0]!.target];
      else
        record.document.annotations[0]!.targets = record.document.annotations[0]!.targets.filter(
          (target) => target.id !== child.id,
        );
      await database.db.put('pages', record, database.pageKeys[0]!);
      const restored = createAinotation({ projectId, mcp: false });
      instances.push(restored);
      await restored.mount();
      const next = document.querySelector('ainotation-inspector-shell')!;
      await vi.waitFor(() => expect(next.view.storage).toBe('ready'));
      action(next, { type: 'edit', id: note.id });
      expect(next.view.selected.map((target) => target.id)).toEqual(
        record.document.annotations[0]!.targets.map((target) => target.id),
      );
      expect(Object.values(next.view.targetNavigation).every((value) => !value.back)).toBe(true);
    },
  );
  it('remembers a saved marker tab, dragged position and single-target scope across reopen and remount', async () => {
    const { instance, shell, buttons, fixture, projectId, read } = await setup({ mcp: false });
    const parent = document.createElement('section');
    fixture.replaceWith(parent);
    parent.append(fixture);
    fixtures.push(parent);
    buttons[0]!.style.padding = '8px';
    fixture.style.padding = '4px';
    select(buttons[0]!);
    const child = shell.view.selected[0]!;
    action(shell, { type: 'editor-tab', value: 'styles' });
    action(shell, { type: 'editor-position', position: { x: 200, y: 40 } });
    action(shell, { type: 'style-change', property: 'padding-top', value: '16px', linked: false });
    action(shell, { type: 'navigate-target', id: child.id, direction: 'parent' });
    const container = shell.view.selected[0]!;
    action(shell, { type: 'style-change', property: 'padding-top', value: '12px', linked: false });
    await save(shell, 'Remember editor');
    const note = shell.view.document!.annotations[0]!;
    expect(note.targets).toHaveLength(2);
    await vi.waitFor(async () =>
      expect((await read())?.editorViews?.[note.id]).toMatchObject({
        tab: 'styles',
        targets: [container.id],
        position: { x: 200, y: 40 },
      }),
    );
    action(shell, { type: 'edit', id: note.id });
    expect(shell.view.editorTab).toBe('styles');
    expect(shell.view.editorPosition).toEqual({ x: 200, y: 40 });
    expect(shell.view.styleEditor.scopeCount).toBe(1);
    expect(shell.view.styleTargets.map((target) => target.id)).toEqual([container.id]);
    expect(shell.view.targetNavigation[container.id]?.back).toBe(true);
    action(shell, { type: 'navigate-target', id: container.id, direction: 'parent' });
    const ancestor = shell.view.selected[0]!;
    expect(ancestor.tagName).toBe('section');
    expect(shell.view.styleTargets.map((target) => target.id)).toEqual([ancestor.id]);
    expect(shell.view.styleEditor.scopeCount).toBe(1);
    action(shell, { type: 'navigate-target', id: ancestor.id, direction: 'back' });
    expect(shell.view.styleTargets.map((target) => target.id)).toEqual([container.id]);
    action(shell, { type: 'close-edit' });
    await vi.waitFor(async () =>
      expect((await read())?.draft).toMatchObject({ editorOpen: false, editingId: note.id }),
    );
    instance.destroy();
    const restored = createAinotation({ projectId, mcp: false });
    instances.push(restored);
    await restored.mount();
    const next = document.querySelector('ainotation-inspector-shell')!;
    await vi.waitFor(() => expect(next.view.storage).toBe('ready'));
    next.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
    action(next, { type: 'edit', id: note.id });
    expect(next.view.editorTab).toBe('styles');
    expect(next.view.editorPosition).toEqual({ x: 200, y: 40 });
    expect(next.view.styleEditor.scopeCount).toBe(1);
    expect(next.view.styleTargets.map((target) => target.id)).toEqual([container.id]);
    expect(next.view.selected.map((target) => target.id)).toEqual([container.id]);
    expect(next.view.targetNavigation[container.id]?.back).toBe(true);
    action(next, { type: 'navigate-target', id: container.id, direction: 'back' });
    expect(next.view.selected.map((target) => target.id)).toEqual([child.id]);
    expect(next.view.targetNavigation[child.id]?.parent).toBe(true);
    action(next, { type: 'navigate-target', id: child.id, direction: 'parent' });
    await save(next, 'Navigation restored');
    expect(next.view.document!.annotations[0]!.targets.map((target) => target.id).sort()).toEqual(
      [container.id, child.id].sort(),
    );
  });

  it('preserves explicit Shift selections and independent navigation paths on save and reopen', async () => {
    const { shell, buttons, fixture, read } = await setup({ mcp: false });
    const wrappers = buttons.map((button) => {
      const wrapper = document.createElement('section');
      fixture.append(wrapper);
      wrapper.append(button);
      button.style.padding = '8px';
      wrapper.style.padding = '4px';
      return wrapper;
    });
    await selectMultiple(shell, buttons);
    const children = structuredClone(shell.view.selected);
    action(shell, { type: 'style-change', property: 'padding-top', value: '16px', linked: false });
    action(shell, { type: 'navigate-target', id: children[0]!.id, direction: 'parent' });
    const parent = shell.view.selected[0]!;
    expect(shell.view.selected.map((target) => target.id)).toEqual([parent.id, children[1]!.id]);
    action(shell, { type: 'style-target', id: parent.id });
    action(shell, { type: 'style-change', property: 'padding-top', value: '12px', linked: false });
    await save(shell, 'Two independent slots');
    const annotation = shell.view.document!.annotations[0]!;
    expect(annotation.targets).toHaveLength(3);
    await vi.waitFor(async () =>
      expect((await read())?.editorViews?.[annotation.id]?.navigation?.slots).toHaveLength(2),
    );
    action(shell, { type: 'edit', id: annotation.id });
    expect(shell.view.selected.map((target) => target.id)).toEqual([parent.id, children[1]!.id]);
    expect(shell.view.styleTargetId).toBe(parent.id);
    expect(shell.view.styleEditor.scopeCount).toBe(1);
    action(shell, { type: 'navigate-target', id: parent.id, direction: 'back' });
    expect(shell.view.selected.map((target) => target.id)).toEqual(
      children.map((target) => target.id),
    );
    expect(shell.view.styleTargetId).toBe(children[0]!.id);
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['16px', '16px']);
    expect(wrappers[0]!.style.paddingTop).toBe('12px');
  });

  it('closes the current editor on an ordinary outside pick before allowing another selection', async () => {
    const { shell, buttons, read } = await setup({ mcp: false });
    buttons[0]!.style.padding = '8px';
    select(buttons[0]!);
    const initial = structuredClone(shell.view.marker),
      first = shell.view.selected[0]!.id;
    action(shell, { type: 'draft', value: 'Keep this draft' });
    action(shell, { type: 'style-change', property: 'padding-top', value: '16px', linked: false });
    select(buttons[1]!);
    expect(shell.view.editorOpen).toBe(false);
    expect(shell.view.marker).toEqual(initial);
    expect(shell.view.selected[0]!.id).toBe(first);
    expect(shell.view.draft).toBe('Keep this draft');
    expect(buttons[0]!.style.paddingTop).toBe('16px');
    expect(shell.view.document!.annotations).toHaveLength(0);
    await vi.waitFor(async () => expect((await read())?.draft.editorOpen).toBe(false));
    select(buttons[1]!);
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.selected[0]!.attributes.id).toBe(buttons[1]!.id);
  });
  it('can save removal of shared styles from another marker and persists global preview off', async () => {
    const { instance, shell, buttons, read, projectId } = await setup({ mcp: false });
    const button = buttons[0]!;
    button.style.padding = '8px';
    select(button);
    action(shell, { type: 'style-change', property: 'padding-top', value: '20px', linked: false });
    await save(shell, 'Original marker');
    select(button);
    action(shell, { type: 'style-reset' });
    expect(shell.view.styleEditor.count).toBe(0);
    expect(shell.view.styleEditor.dirty).toBe(true);
    action(shell, { type: 'save' });
    await vi.waitFor(() => expect(shell.view.document!.annotations).toHaveLength(2));
    // Closing precedes draft persistence; wait until another save can be accepted.
    await vi.waitFor(() => expect(shell.view).toMatchObject({ editorOpen: false, saving: false }));
    expect(shell.view.document!.targetStyles).toBeUndefined();
    expect(shell.view.document!.annotations.every((note) => !note.targets[0]!.styleChanges)).toBe(
      true,
    );
    const first = shell.view.document!.annotations[0]!;
    action(shell, { type: 'edit', id: first.id });
    action(shell, { type: 'style-change', property: 'padding-top', value: '24px', linked: false });
    await save(shell, 'Saved again');
    action(shell, { type: 'global-style-preview', value: false });
    await vi.waitFor(async () => expect((await read())?.stylePreview?.enabled).toBe(false));
    instance.destroy();
    const next = createAinotation({ projectId, mcp: false });
    instances.push(next);
    await next.mount();
    const restored = document.querySelector('ainotation-inspector-shell')!;
    await vi.waitFor(() => expect(restored.view.storage).toBe('ready'));
    expect(restored.view.styleEditor.globalPreview).toBe(false);
    expect(button.style.paddingTop).toBe('8px');
    action(restored, { type: 'global-style-preview', value: true });
    expect(button.style.paddingTop).toBe('24px');
  });
  it('shares one target style across markers while keeping global and local previews independent', async () => {
    const { shell, buttons, read } = await setup({ mcp: false });
    const [first, second] = buttons as [HTMLButtonElement, HTMLButtonElement];
    first.style.padding = '8px';
    second.style.padding = '12px';
    const edit = (value: string) =>
      action(shell, { type: 'style-change', property: 'padding-top', value, linked: false });
    select(first);
    edit('20px');
    await save(shell, 'First marker');
    const a = shell.view.document!.annotations[0]!;
    expect(first.style.paddingTop).toBe('20px');
    select(second);
    edit('30px');
    await save(shell, 'Second element');
    const b = shell.view.document!.annotations[1]!;
    expect(first.style.paddingTop).toBe('20px');
    expect(second.style.paddingTop).toBe('30px');
    select(first);
    await save(shell, 'Another marker on first');
    const c = shell.view.document!.annotations[2]!;
    expect(c.targets[0]!.id).toBe(a.targets[0]!.id);
    expect(Object.keys(shell.view.document!.targetStyles!)).toHaveLength(2);
    action(shell, { type: 'edit', id: c.id });
    edit('24px');
    expect(shell.view.styleEditor.sharedMarkers).toBe(2);
    action(shell, { type: 'close-edit' });
    expect(shell.view.editorOpen).toBe(false);
    expect(first.style.paddingTop).toBe('24px');
    expect(second.style.paddingTop).toBe('30px');
    action(shell, { type: 'edit', id: a.id });
    expect(shell.view.styleEditor.current['padding-top']).toBe('24px');
    action(shell, { type: 'style-preview', value: false });
    expect(first.style.paddingTop).toBe('8px');
    expect(second.style.paddingTop).toBe('30px');
    action(shell, { type: 'global-style-preview', value: false });
    expect(first.style.paddingTop).toBe('8px');
    expect(second.style.paddingTop).toBe('12px');
    action(shell, { type: 'global-style-preview', value: true });
    expect(first.style.paddingTop).toBe('8px');
    expect(second.style.paddingTop).toBe('30px');
    action(shell, { type: 'style-preview', value: true });
    expect(first.style.paddingTop).toBe('24px');
    action(shell, { type: 'cancel-edit' });
    await vi.waitFor(() => expect(shell.view.editorOpen).toBe(false));
    expect(first.style.paddingTop).toBe('20px');
    expect(second.style.paddingTop).toBe('30px');
    action(shell, { type: 'edit', id: c.id });
    edit('26px');
    await save(shell, 'Shared final size');
    const doc = shell.view.document!;
    expect(
      doc.annotations
        .filter((note) => note.targets[0]!.id === a.targets[0]!.id)
        .map((note) => note.targets[0]!.styleChanges?.[0]?.value),
    ).toEqual(['26px', '26px']);
    expect(doc.annotations.find((note) => note.id === a.id)!.comment).toBe('First marker');
    action(shell, { type: 'delete', id: c.id });
    await vi.waitFor(() => expect(shell.view.document!.annotations).toHaveLength(2));
    expect(first.style.paddingTop).toBe('26px');
    action(shell, { type: 'delete', id: a.id });
    await vi.waitFor(() => expect(shell.view.document!.annotations).toHaveLength(1));
    expect(first.style.paddingTop).toBe('8px');
    expect(second.style.paddingTop).toBe('30px');
    expect(Object.keys(shell.view.document!.targetStyles!)).toEqual([b.targets[0]!.id]);
    action(shell, { type: 'global-style-preview', value: false });
    await vi.waitFor(async () => expect((await read())?.stylePreview?.enabled).toBe(false));
    expect(second.style.paddingTop).toBe('12px');
  });

  it('applies multi-target edits atomically with mixed values, relative steps and partial local preview', async () => {
    const { shell, buttons } = await setup({ mcp: false });
    buttons[0]!.style.padding = '8px';
    buttons[1]!.style.padding = '12px';
    await selectMultiple(shell, buttons);
    expect(shell.view.styleTargetId).toBe('');
    expect(shell.view.styleEditor.scopeCount).toBe(2);
    expect(shell.view.styleEditor.mixed).toContain('padding-top');
    action(shell, {
      type: 'style-step',
      property: 'padding-top',
      direction: 1,
      coarse: false,
      linked: false,
    });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['9px', '13px']);
    action(shell, { type: 'style-history', direction: 'undo' });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['8px', '12px']);
    action(shell, { type: 'style-history', direction: 'redo' });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['9px', '13px']);
    action(shell, { type: 'style-change', property: 'padding-top', value: '20px', linked: false });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['20px', '20px']);
    expect(shell.view.styleEditor.mixed).not.toContain('padding-top');
    action(shell, { type: 'style-reset', property: 'padding-top' });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['8px', '12px']);
    action(shell, { type: 'style-history', direction: 'undo' });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['20px', '20px']);
    const firstId = shell.view.selected[0]!.id;
    action(shell, { type: 'style-target', id: firstId });
    action(shell, { type: 'style-preview', value: false });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['8px', '20px']);
    action(shell, { type: 'style-target', id: '' });
    expect(shell.view.styleEditor.previewMixed).toBe(true);
    action(shell, { type: 'style-preview', value: true });
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['20px', '20px']);
    await save(shell, 'Batch change');
    expect(
      Object.values(shell.view.document!.targetStyles!).map((changes) => changes[0]!.before),
    ).toEqual(['8px', '12px']);
    expect(buttons.map((button) => button.style.paddingTop)).toEqual(['20px', '20px']);
  });
  it.each([true, false])(
    'keeps preview %s while navigating between parent and child, and captures unmodified geometry',
    async (enabled) => {
      const { shell, buttons, fixture, read } = await setup({ mcp: false });
      const button = buttons[0]!;
      button.style.padding = '8px';
      fixture.style.padding = '4px';
      const originalHeight = fixture.getBoundingClientRect().height;
      select(button);
      expect(shell.view.styleEditor.preview).toBe(true);
      const child = structuredClone(shell.view.selected[0]!);
      action(shell, { type: 'editor-tab', value: 'styles' });
      action(shell, {
        type: 'style-change',
        property: 'padding-top',
        value: '20px',
        linked: false,
      });
      if (!enabled) action(shell, { type: 'global-style-preview', value: false });
      action(shell, { type: 'navigate-target', id: child.id, direction: 'parent' });
      const parent = shell.view.selected[0]!;
      expect(parent.attributes.id).toBe(fixture.id);
      expect(parent.rect.height).toBe(originalHeight);
      expect(parent.styles.padding).toBe('4px');
      expect(shell.view.styleEditor.globalPreview).toBe(enabled);
      expect(button.style.paddingTop).toBe(enabled ? '20px' : '8px');
      action(shell, {
        type: 'style-change',
        property: 'padding-top',
        value: '12px',
        linked: false,
      });
      expect(fixture.style.paddingTop).toBe(enabled ? '12px' : '4px');
      for (let i = 0; i < 2; i++) {
        action(shell, { type: 'navigate-target', id: parent.id, direction: 'back' });
        expect(shell.view.selected[0]!.id).toBe(child.id);
        expect(shell.view.selected[0]!.styles.padding).toBe('8px');
        expect(shell.view.styleEditor.globalPreview).toBe(enabled);
        expect(button.style.paddingTop).toBe(enabled ? '20px' : '8px');
        action(shell, { type: 'navigate-target', id: child.id, direction: 'parent' });
        expect(shell.view.styleEditor.globalPreview).toBe(enabled);
        expect(fixture.style.paddingTop).toBe(enabled ? '12px' : '4px');
      }
      await vi.waitFor(async () => expect((await read())?.draft.styleTargets).toHaveLength(2));
      expect(shell.view.styleEditor.globalPreview).toBe(enabled);
    },
  );
  it('keeps previews when collapsed and isolates shared drafts and preview preferences by URL', async () => {
    const { shell, buttons, read, pageKeys, projectId } = await setup({ mcp: false });
    const button = buttons[0]!;
    button.style.padding = '8px';
    select(button);
    action(shell, { type: 'style-change', property: 'padding-top', value: '24px', linked: false });
    await vi.waitFor(async () =>
      expect((await read())?.draft.styleTargets?.[0]?.styleChanges).toHaveLength(1),
    );
    shell.expanded = false;
    action(shell, { type: 'set-picking', value: false });
    expect(button.style.paddingTop).toBe('24px');
    shell.expanded = true;
    action(shell, { type: 'set-picking', value: true });
    expect(shell.view.styleEditor.preview).toBe(true);
    action(shell, { type: 'style-preview', value: true });
    expect(button.style.paddingTop).toBe('24px');
    const original = location.href;
    const nextUrl = new URL(original);
    nextUrl.hash = 'style-route-test';
    pageKeys.push(JSON.stringify([projectId, nextUrl.href]));
    try {
      history.pushState(null, '', nextUrl.href);
      action(shell, { type: 'draft', value: 'Must not enter previous page' });
      await vi.waitFor(() => expect(shell.view.document?.url).toBe(nextUrl.href));
      expect(button.style.paddingTop).toBe('8px');
      expect(shell.view.styleEditor.count).toBe(0);
      history.replaceState(null, '', original);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(shell.view.document?.url).toBe(original));
      expect(shell.view.styleEditor.count).toBe(1);
      expect(shell.view.styleEditor.preview).toBe(true);
      expect(button.style.paddingTop).toBe('24px');
    } finally {
      history.replaceState(null, '', original);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  });
  it('persists shared styles, keeps saved previews and restores committed values on cancel', async () => {
    const { instance, shell, buttons, read, projectId } = await setup({ mcp: false });
    const button = buttons[0]!;
    button.style.padding = '8px';
    select(button);
    await vi.waitFor(() => expect(shell.view.selected).toHaveLength(1));
    const original = structuredClone(shell.view.selected[0]!);
    action(shell, { type: 'editor-tab', value: 'styles' });
    action(shell, { type: 'style-change', property: 'padding-top', value: '20px', linked: false });
    await vi.waitFor(async () =>
      expect((await read())?.draft.styleTargets?.[0]?.styleChanges?.[0]?.value).toBe('20px'),
    );
    expect(button.style.paddingTop).toBe('20px');
    action(shell, { type: 'save' });
    await vi.waitFor(() => expect(shell.view.document?.annotations).toHaveLength(1));
    await vi.waitFor(() => expect(shell.view.editorOpen).toBe(false));
    expect(button.style.paddingTop).toBe('20px');
    const saved = shell.view.document!.annotations[0]!;
    expect(saved.targets[0]!.styles).toEqual(original.styles);
    expect(saved.targets[0]!.styleChanges).toEqual([
      { property: 'padding-top', before: '8px', value: '20px' },
    ]);
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    vi.spyOn(navigator.clipboard, 'write').mockResolvedValue();
    expect(await instance.copyFeedback()).toContain('padding-top: "8px" → "20px"');
    action(shell, { type: 'edit', id: saved.id });
    await vi.waitFor(() => expect(shell.view.editingId).toBe(saved.id));
    expect(shell.view.styleEditor.preview).toBe(true);
    action(shell, { type: 'style-preview', value: true });
    expect(button.style.paddingTop).toBe('20px');
    action(shell, { type: 'style-change', property: 'padding-top', value: '30px', linked: false });
    action(shell, { type: 'cancel-edit' });
    await vi.waitFor(() => expect(shell.view.editorOpen).toBe(false));
    expect(button.style.paddingTop).toBe('20px');
    expect(shell.view.document!.annotations[0]).toEqual(saved);
    action(shell, { type: 'edit', id: saved.id });
    action(shell, { type: 'style-reset' });
    await vi.waitFor(async () =>
      expect((await read())?.styleDrafts?.[0]?.styleChanges).toEqual([]),
    );
    instance.destroy();
    const remounted = createAinotation({ projectId, mcp: false });
    instances.push(remounted);
    await remounted.mount();
    const restored = document.querySelector('ainotation-inspector-shell')!;
    await vi.waitFor(() => expect(restored.view.storage).toBe('ready'));
    expect(restored.view.editingId).toBe(saved.id);
    expect(restored.view.styleEditor.count).toBe(0);
    expect(restored.view.document!.annotations[0]!.targets[0]!.styleChanges).toHaveLength(1);
  });
  it('restores per-target shared drafts and the global preview across remount', async () => {
    const { instance, shell, buttons, fixture, projectId, read } = await setup({ mcp: false });
    buttons[0]!.style.padding = '8px';
    fixture.style.padding = '4px';
    select(buttons[0]!);
    const original = shell.view.selected[0]!;
    action(shell, { type: 'style-change', property: 'padding-top', value: '20px', linked: false });
    action(shell, { type: 'navigate-target', id: original.id, direction: 'parent' });
    await vi.waitFor(() => expect(shell.view.selected[0]?.attributes.id).toBe(fixture.id));
    action(shell, { type: 'style-change', property: 'padding-top', value: '12px', linked: false });
    await vi.waitFor(async () => expect((await read())?.draft.styleTargets).toHaveLength(2));
    instance.destroy();
    expect(buttons[0]!.style.paddingTop).toBe('8px');
    expect(fixture.style.paddingTop).toBe('4px');
    const next = createAinotation({ projectId, mcp: false });
    instances.push(next);
    await next.mount();
    const nextShell = document.querySelector('ainotation-inspector-shell')!;
    await vi.waitFor(() => expect(nextShell.view.styleEditor.count).toBe(2));
    expect(nextShell.view.styleEditor.preview).toBe(true);
    expect(buttons[0]!.style.paddingTop).toBe('20px');
    expect(fixture.style.paddingTop).toBe('12px');
    nextShell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
    action(nextShell, { type: 'save' });
    await vi.waitFor(() => expect(nextShell.view.document?.annotations).toHaveLength(1));
    expect(nextShell.view.document!.annotations[0]!.targets).toHaveLength(2);
    expect(
      nextShell.view.document!.annotations[0]!.targets.every(
        (target) => target.styleChanges?.length === 1,
      ),
    ).toBe(true);
  });
  it('retargets drafts without losing text, persists explicit saved-target edits and cancels without changing the saved target', async () => {
    const { instance, shell, buttons, fixture, read } = await setup();
    select(buttons[0]!);
    const original = shell.view.selected[0]!;
    action(shell, { type: 'draft', value: 'Keep my comment' });
    await vi.waitFor(async () => expect((await read())?.draft.text).toBe('Keep my comment'));
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 16;
    const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
    action(shell, {
      type: 'import-image',
      file: new File([png], 'target.png', { type: 'image/png' }),
    });
    await vi.waitFor(() =>
      expect(
        document
          .querySelector('[data-ainotation-ui="drawing"]')
          ?.shadowRoot?.querySelector('[aria-label="Attach image"]'),
      ).toBeTruthy(),
    );
    document
      .querySelector('[data-ainotation-ui="drawing"]')!
      .shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Attach image"]')!
      .click();
    // Image composition and IndexedDB persistence can exceed the default one-second
    // poll on hosted browser runners. Still require the editor to finish and close.
    await vi.waitFor(
      () => expect(document.querySelector('[data-ainotation-ui="drawing"]')).toBeNull(),
      { timeout: 5000 },
    );
    const images = structuredClone(shell.view.images);
    expect(images).toHaveLength(1);
    const anchor = structuredClone(shell.view.marker);
    action(shell, { type: 'navigate-target', id: original.id, direction: 'parent' });
    await vi.waitFor(async () =>
      expect((await read())?.draft.targets[0]!.attributes.id).toBe(fixture.id),
    );
    expect(shell.view.draft).toBe('Keep my comment');
    expect(shell.view.images).toEqual(images);
    expect(shell.view.marker!.x).toBeCloseTo(anchor!.x, 8);
    expect(shell.view.marker!.y).toBeCloseTo(anchor!.y, 8);
    const parent = shell.view.selected[0]!;
    action(shell, { type: 'navigate-target', id: parent.id, direction: 'back' });
    await vi.waitFor(() => expect(shell.view.selected[0]!.id).toBe(original.id));
    await save(shell, 'Original button note');
    const saved = instance.getDocument()!.annotations[0]!;
    action(shell, { type: 'edit', id: saved.id });
    action(shell, { type: 'navigate-target', id: saved.targets[0]!.id, direction: 'parent' });
    await vi.waitFor(async () => expect((await read())?.draft.targetsAdjusted).toBe(true));
    expect(instance.getDocument()!.annotations[0]).toEqual(saved);
    action(shell, { type: 'cancel-edit' });
    await vi.waitFor(() => expect(shell.view.editorOpen).toBe(false));
    expect(instance.getDocument()!.annotations[0]).toEqual(saved);
    action(shell, { type: 'edit', id: saved.id });
    expect(shell.view.selected[0]!.attributes.id).toBe(fixture.id);
    expect(shell.view.targetNavigation[shell.view.selected[0]!.id]?.back).toBe(true);
    await vi.waitFor(async () => expect((await read())?.draft.targetsAdjusted).toBe(true));
    instance.destroy();
    await instance.mount();
    const restored = document.querySelector('ainotation-inspector-shell')!;
    restored.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
    await vi.waitFor(() => expect(restored.view.picking).toBe(true));
    expect(restored.view.targetsAdjusted).toBe(true);
    expect(restored.view.draft).toBe(saved.comment);
    await save(restored, saved.comment);
    const updated = instance.getDocument()!.annotations[0]!;
    expect(updated.id).toBe(saved.id);
    expect(updated.targets[0]!.attributes.id).toBe(fixture.id);
    expect(updated.images).toEqual(images);
    expect(instance.getDocument()!.annotations).toHaveLength(1);
  });

  it('recovers saved project pages without navigating to each page', async () => {
    const { shell, buttons, read, projectId, pageKeys } = await setup();
    select(buttons[0]!);
    await save(shell, 'Current page');
    const first = (await read())!;
    const otherUrl = `${location.origin}/other-recovery-page`;
    const otherKey = JSON.stringify([projectId, otherUrl]);
    pageKeys.push(otherKey);
    await databases.at(-1)!.db.put(
      'pages',
      {
        ...first,
        document: {
          ...first.document,
          id: crypto.randomUUID(),
          url: otherUrl,
          annotations: first.document.annotations.map((annotation) => ({
            ...annotation,
            id: crypto.randomUUID(),
            comment: 'Other saved page',
            page: { ...annotation.page, url: otherUrl },
          })),
        },
        operations: [],
      },
      otherKey,
    );
    const posted: string[] = [];
    const epoch = crypto.randomUUID();
    vi.spyOn(window, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        const request = JSON.parse(init.body as string) as {
          document: import('@ainotation/schema').FeedbackDocument;
          operations: { id: string }[];
        };
        posted.push(request.document.url);
        return Response.json({
          document: request.document,
          acknowledged: request.operations.map((operation) => operation.id),
          storageEpoch: epoch,
          missingImages: [],
        });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('Stopped')), {
              once: true,
            });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    action(shell, {
      type: 'connect',
      endpoint: 'http://127.0.0.1:4748',
      token: 'recovery-test-token',
    });
    await vi.waitFor(() => expect(shell.view.connection).toBe('connected'));
    action(shell, { type: 'recover-project' });
    await vi.waitFor(() => {
      expect(shell.view.recoveringProject).toBe(false);
      expect(shell.view.message).toBe('Checked 2 of 2 saved pages.');
    });
    expect(posted).toContain(otherUrl);
    expect(shell.view.recoveryPages).toEqual([]);
    expect(location.href).toBe(first.document.url);
    const beforeCancellation = await read();
    let transferSignal: AbortSignal | undefined;
    vi.spyOn(window, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          transferSignal = init?.signal ?? undefined;
          transferSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    action(shell, { type: 'recover-project' });
    await vi.waitFor(() => expect(transferSignal).toBeDefined());
    action(shell, { type: 'disconnect' });
    await vi.waitFor(() => expect(shell.view.recoveringProject).toBe(false));
    expect(transferSignal?.aborted).toBe(true);
    expect(await read()).toEqual(beforeCancellation);
  });

  it('keeps local-only feedback and images usable without restoring or changing MCP credentials', async () => {
    const projectId = crypto.randomUUID();
    const credentialsKey = `ainotation:mcp:${projectId}`;
    const credentials = { endpoint: 'http://127.0.0.1:4748', token: 'saved-test-token' };
    const storedCredentials = JSON.stringify(credentials);
    sessionStorage.setItem(credentialsKey, storedCredentials);
    const originalUrl = location.href;
    const originalGet = sessionStorage.getItem.bind(sessionStorage);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 503 }));
    const clipboard = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    try {
      const { instance, shell, buttons, read, pageKeys } = await setup({ projectId, mcp: false });
      expect(shell.view).toMatchObject({
        localOnly: true,
        managedConnection: false,
        endpoint: '',
        connection: 'offline',
        syncing: false,
      });
      action(shell, { type: 'connect', ...credentials });
      action(shell, { type: 'disconnect' });
      select(buttons[0]!);
      await save(shell, 'Local feedback');
      const annotation = instance.getDocument()!.annotations[0]!;
      action(shell, { type: 'edit', id: annotation.id });
      await save(shell, 'Updated local feedback');
      expect(await instance.copyFeedback()).toContain('Updated local feedback');
      expect(clipboard).toHaveBeenCalledOnce();
      action(shell, { type: 'export' });
      await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
      const json = createUrl.mock.calls.at(-1)![0] as Blob;
      expect(await json.text()).toContain('Updated local feedback');

      // Exercise a real image attachment, then the ZIP export, with MCP disabled.
      action(shell, { type: 'edit', id: annotation.id });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
      action(shell, {
        type: 'import-image',
        file: new File([png], 'local.png', { type: 'image/png' }),
      });
      await vi.waitFor(() => {
        const attach = document
          .querySelector('[data-ainotation-ui="drawing"]')
          ?.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Attach image"]');
        expect(attach).toBeTruthy();
      });
      document
        .querySelector('[data-ainotation-ui="drawing"]')!
        .shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Attach image"]')!
        .click();
      await vi.waitFor(() => expect(shell.view.images).toHaveLength(1));
      await save(shell, 'Local feedback with an image');
      const image = instance.getDocument()!.annotations[0]!.images![0]!;
      expect((await read())?.images?.[image.id]).toBeInstanceOf(Blob);
      action(shell, { type: 'export' });
      await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
      const zip = createUrl.mock.calls.at(-1)![0] as Blob;
      expect(new Uint8Array(await zip.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([80, 75]));

      const saved = instance.getDocument();
      const nextUrl = new URL(originalUrl);
      nextUrl.hash = `local-${projectId}`;
      pageKeys.push(JSON.stringify([projectId, nextUrl.href]));
      history.replaceState(null, '', nextUrl.href);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(shell.view.document?.url).toBe(nextUrl.href));
      history.replaceState(null, '', originalUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(instance.getDocument()).toEqual(saved));
      instance.destroy();
      await instance.mount();
      const restored = document.querySelector('ainotation-inspector-shell')!;
      expect(instance.getDocument()).toEqual(saved);
      expect(restored.view).toMatchObject({
        localOnly: true,
        connection: 'offline',
        syncing: false,
      });
      action(restored, {
        type: 'connect',
        endpoint: 'http://127.0.0.1:4749',
        token: 'new-test-token',
      });
      action(restored, { type: 'delete', id: annotation.id });
      await vi.waitFor(async () => expect((await read())?.document.annotations).toEqual([]));
      expect(fetch).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalledWith(credentialsKey);
      expect(setItem.mock.calls.some(([key]) => key === credentialsKey)).toBe(false);
      expect(removeItem).not.toHaveBeenCalledWith(credentialsKey);
      expect(originalGet(credentialsKey)).toBe(storedCredentials);
    } finally {
      history.replaceState(null, '', originalUrl);
      sessionStorage.removeItem(credentialsKey);
    }
  });

  it('ignores malformed saved MCP credentials in local-only mode', async () => {
    const projectId = crypto.randomUUID();
    const key = `ainotation:mcp:${projectId}`;
    sessionStorage.setItem(key, '{invalid');
    try {
      const { shell } = await setup({ projectId, mcp: false });
      expect(shell.view.localOnly).toBe(true);
      expect(shell.view.message).toBe('');
      expect(sessionStorage.getItem(key)).toBe('{invalid');
    } finally {
      sessionStorage.removeItem(key);
    }
  });

  it.each(['saved', 'explicit'] as const)(
    'retains %s manual MCP connections when local-only mode is not enabled',
    async (source) => {
      const projectId = crypto.randomUUID();
      const key = `ainotation:mcp:${projectId}`;
      const saved = { endpoint: 'http://127.0.0.1:4748', token: 'saved-test-token' };
      const explicit = { endpoint: 'http://127.0.0.1:4749', token: 'explicit-test-token' };
      sessionStorage.setItem(key, JSON.stringify(saved));
      const fetch = vi
        .spyOn(window, 'fetch')
        .mockImplementation(async () => new Response(null, { status: 503 }));
      try {
        const { shell } = await setup({
          projectId,
          ...(source === 'explicit' ? { mcp: explicit } : {}),
        });
        const connection = source === 'explicit' ? explicit : saved;
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(shell.view.localOnly).toBe(false);
        expect(shell.view.endpoint).toBe(connection.endpoint);
        expect(
          fetch.mock.calls.some(
            ([url, init]) =>
              (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).startsWith(
                `${connection.endpoint}/sessions/`,
              ) && new Headers(init?.headers).get('Authorization') === `Bearer ${connection.token}`,
          ),
        ).toBe(true);
      } finally {
        sessionStorage.removeItem(key);
      }
    },
  );

  it('rejects combining a development bridge with local-only mode before connecting', async () => {
    const fetch = vi.spyOn(window, 'fetch');
    const instance = createAinotation({
      mcp: false,
      development: { bridge: '/__ainotation', projectName: 'test' },
    });
    instances.push(instance);
    await expect(instance.mount()).rejects.toThrow(
      'Local-only mode (mcp: false) cannot use a development bridge.',
    );
    expect(instance.mounted).toBe(false);
    expect(document.querySelector('ainotation-inspector-shell')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears all saved markers and an active draft through the toolbar and persists the result', async () => {
    const { shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'First saved note');
    select(buttons[1]!);
    await save(shell, 'Second saved note');
    select(buttons[0]!);
    action(shell, { type: 'draft', value: 'Unsent note' });
    await vi.waitFor(async () => expect((await read())?.draft.text).toBe('Unsent note'));
    await shell.updateComplete;
    shell
      .shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Clear all annotations"]')!
      .click();
    await vi.waitFor(async () => {
      expect(shell.view.document?.annotations).toEqual([]);
      expect(shell.view).toMatchObject({
        selected: [],
        draft: '',
        editorOpen: false,
        marker: null,
        picking: true,
        saving: false,
      });
      expect((await read())?.document.annotations).toEqual([]);
      expect((await read())?.draft).toMatchObject({ text: '', targets: [], editorOpen: false });
      expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(0);
    });
    expect(
      (await read())?.operations.filter((operation) => operation.kind === 'delete'),
    ).toHaveLength(2);
    expect(shell.expanded).toBe(true);
  });

  it.each(['Close inspector', 'shortcut'])(
    'hides selection on %s and restores it without changing persistent data',
    async (closeWith) => {
      const { instance, shell, buttons, read } = await setup();
      await selectMultiple(shell, buttons);
      await save(shell, 'Saved feedback survives closing');
      const saved = instance.getDocument();
      await selectMultiple(shell, buttons);
      action(shell, { type: 'draft', value: 'Keep this unsent text' });
      const targets = structuredClone(shell.view.selected);
      const marker = structuredClone(shell.view.marker);
      const selection = overlay('selection');
      const markers = overlay('markers');
      await vi.waitFor(async () => {
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(2);
        expect(markers.shadowRoot!.querySelectorAll('.marker')).toHaveLength(2);
        expect((await read())?.draft).toMatchObject({
          text: 'Keep this unsent text',
          targets,
          marker,
          editorOpen: true,
        });
      });
      const before = await read();
      await shell.updateComplete;
      if (closeWith === 'shortcut') {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyA',
            altKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else
        shell.shadowRoot!.querySelector<HTMLButtonElement>(`[aria-label="${closeWith}"]`)!.click();
      await vi.waitFor(async () => {
        expect(shell.expanded).toBe(false);
        expect(shell.view).toMatchObject({
          picking: false,
          selected: targets,
          draft: 'Keep this unsent text',
          marker,
          editorOpen: true,
        });
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
        expect(getComputedStyle(markers).display).toBe('none');
        expect(instance.getDocument()).toEqual(saved);
        expect(await read()).toEqual(before);
      });
      const hostClick = vi.fn();
      buttons[0]!.addEventListener('click', hostClick, { once: true });
      buttons[0]!.click();
      expect(hostClick).toHaveBeenCalledOnce();
      expect(shell.view.selected).toEqual(targets);
      await shell.updateComplete;
      shell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
      await vi.waitFor(async () => {
        expect(shell.view).toMatchObject({
          picking: true,
          selected: targets,
          draft: 'Keep this unsent text',
          marker,
          editorOpen: true,
        });
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(2);
        expect(getComputedStyle(markers).display).toBe('block');
        expect(
          markers.shadowRoot!.querySelector('[aria-label="Edit annotation 1"]'),
        ).not.toBeNull();
        expect(markers.shadowRoot!.querySelector('[aria-label="New feedback"]')).not.toBeNull();
        expect(instance.getDocument()).toEqual(saved);
        expect(await read()).toEqual(before);
      });
    },
  );

  it.each(['draft', 'save'] as const)(
    'reconciles an immediate %s action after pushState before it can modify the previous page',
    async (firstAction) => {
      const { instance, shell, buttons, read, projectId, pageKeys } = await setup();
      const originalUrl = location.href;
      const originalState = history.state;
      const nextUrl = new URL(originalUrl);
      nextUrl.searchParams.set('ainotation-page', crypto.randomUUID());
      pageKeys.push(JSON.stringify([projectId, nextUrl.href]));
      try {
        select(buttons[0]!);
        await save(shell, 'Saved on page A');
        select(buttons[1]!);
        action(shell, { type: 'draft', value: 'Unsent draft on page A' });
        await vi.waitFor(async () => {
          expect((await read())?.draft).toMatchObject({
            text: 'Unsent draft on page A',
            targets: shell.view.selected,
            marker: shell.view.marker,
            editorOpen: true,
          });
        });
        const before = await read();

        // No yield between navigation and actions: the 500 ms poll cannot handle this change.
        history.pushState(null, '', nextUrl);
        if (firstAction === 'save') action(shell, { type: 'save' });
        action(shell, { type: 'draft', value: 'Must not leak into page A' });
        action(shell, { type: 'save' });
        expect(shell.view.storage).toBe('loading');
        expect(shell.view.document).toBeNull();
        expect(shell.view.draft).toBe('');
        expect(shell.view.selected).toEqual([]);
        expect(shell.view.marker).toBeNull();
        expect(shell.view.editorOpen).toBe(false);
        expect(getComputedStyle(overlay('markers')).display).toBe('none');
        await vi.waitFor(() => {
          expect(shell.view.storage).toBe('ready');
          expect(shell.view.document?.url).toBe(nextUrl.href);
          expect(shell.view.picking).toBe(true);
        });
        expect(instance.getDocument()).toMatchObject({ url: nextUrl.href, annotations: [] });
        expect(instance.getDocument()!.id).not.toBe(before!.document.id);
        expect(await read()).toEqual(before);
        expect(await read(nextUrl.href)).toMatchObject({
          document: { url: nextUrl.href, annotations: [] },
          operations: [],
          draft: { text: '', editingId: null, targets: [] },
        });

        select(buttons[1]!);
        await save(shell, 'Saved on page B');
        await vi.waitFor(async () => {
          const saved = await read(nextUrl.href);
          expect(saved?.document.annotations).toHaveLength(1);
          expect(saved?.document.annotations[0]).toMatchObject({
            comment: 'Saved on page B',
            page: { url: nextUrl.href },
            marker: { targetId: saved!.document.annotations[0]!.targets[0]!.id },
          });
          expect(saved?.draft).toMatchObject({
            text: '',
            targets: [],
            editingId: null,
            editorOpen: false,
          });
        });
        expect(await read()).toEqual(before);
      } finally {
        instance.destroy();
        history.replaceState(originalState, '', originalUrl);
      }
    },
  );

  it('adds, edits and deletes a persisted note with stable document, annotation and target IDs', async () => {
    const { instance, shell, buttons, read } = await setup();
    const documentId = instance.getDocument()!.id;
    select(buttons[0]!);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    const target = shell.view.selected[0]!;
    const marker = structuredClone(shell.view.marker);
    expect(target).toMatchObject({ selector: `#${buttons[0]!.id}`, text: 'First target' });
    expect(marker).toMatchObject({
      targetId: target.id,
      space: 'document',
      x: Math.round(target.rect.x + target.rect.width / 2) + scrollX,
      y: Math.round(target.rect.y + target.rect.height / 2) + scrollY,
    });
    await save(shell, 'Original note');
    const original = instance.getDocument()!.annotations[0]!;
    expect(original.targets).toEqual([target]);
    expect(original.marker).toEqual(marker);
    expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(1);

    action(shell, { type: 'edit', id: original.id });
    expect(shell.view.editingId).toBe(original.id);
    expect(shell.view.draft).toBe('Original note');
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.selected).toEqual(original.targets);
    await save(shell, 'Revised note');
    const revised = instance.getDocument()!;
    expect(revised.id).toBe(documentId);
    expect(revised.annotations).toHaveLength(1);
    expect(revised.annotations[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      comment: 'Revised note',
      targets: original.targets,
      marker,
    });
    await vi.waitFor(async () => {
      const saved = await read();
      expect(saved?.document).toEqual(revised);
      expect(saved?.draft).toMatchObject({
        text: '',
        editingId: null,
        targets: [],
        editorOpen: false,
      });
      expect(saved?.draft.marker).toBeUndefined();
      expect(saved?.operations).toMatchObject([
        { kind: 'upsert', annotation: original },
        { kind: 'upsert', annotation: revised.annotations[0] },
      ]);
    });

    action(shell, { type: 'delete', id: original.id });
    await vi.waitFor(async () => {
      expect(instance.getDocument()).toMatchObject({ id: documentId, annotations: [] });
      expect(shell.view.editingId).toBeNull();
      expect(shell.view.draft).toBe('');
      expect(shell.view.picking).toBe(true);
      expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(0);
      const saved = await read();
      expect(saved?.document).toMatchObject({ id: documentId, annotations: [] });
      expect(saved?.draft).toMatchObject({ text: '', editingId: null });
      expect(saved?.operations.at(-1)).toMatchObject({ kind: 'delete', annotationId: original.id });
    });
  });

  it('adds and edits feedback through the inline marker controls while selection stays active', async () => {
    const { instance, shell, buttons, read } = await setup();
    const markers = overlay('markers').shadowRoot!;
    select(buttons[0]!);
    await vi.waitFor(() => {
      expect(markers.querySelector('[aria-label="New annotation"]')).not.toBeNull();
      expect(markers.querySelector('[role="dialog"][aria-label="New feedback"]')).not.toBeNull();
      expect(markers.querySelector<HTMLButtonElement>('.primary')!.disabled).toBe(true);
    });
    const input = markers.querySelector('textarea')!;
    input.value = 'Added inline';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const add = markers.querySelector<HTMLButtonElement>('.primary')!;
    expect(add.getAttribute('aria-label')).toBe('Add');
    expect(add.disabled).toBe(false);
    add.click();
    await vi.waitFor(async () => {
      expect(instance.getDocument()!.annotations).toHaveLength(1);
      expect(shell.view).toMatchObject({
        picking: true,
        saving: false,
        selected: [],
        draft: '',
        marker: null,
        editorOpen: false,
      });
      expect(markers.querySelector('[aria-label="New annotation"]')).toBeNull();
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      expect((await read())?.document).toEqual(instance.getDocument());
    });
    const original = instance.getDocument()!.annotations[0]!;
    markers.querySelector<HTMLButtonElement>('[aria-label="Edit annotation 1"]')!.click();
    await vi.waitFor(() => {
      expect(shell.view).toMatchObject({
        picking: true,
        editingId: original.id,
        editorOpen: true,
        selected: original.targets,
      });
      expect(markers.querySelector('[role="dialog"][aria-label="Edit feedback"]')).not.toBeNull();
      expect(markers.querySelectorAll('.marker')).toHaveLength(1);
    });
    const edit = markers.querySelector('textarea')!;
    edit.value = 'Edited inline';
    edit.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const submit = markers.querySelector<HTMLButtonElement>('.primary')!;
    expect(submit.getAttribute('aria-label')).toBe('Save');
    submit.click();
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({
        picking: true,
        saving: false,
        selected: [],
        draft: '',
        editingId: null,
        marker: null,
        editorOpen: false,
      });
      expect(instance.getDocument()!.annotations).toEqual([
        { ...original, comment: 'Edited inline', updatedAt: expect.any(String) },
      ]);
      expect((await read())?.document).toEqual(instance.getDocument());
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      expect(markers.querySelectorAll('.marker')).toHaveLength(1);
    });
  });

  it.each(['action', 'inline', 'Escape'] as const)(
    'cancels new and saved editors via %s without changing saved feedback or leaving selection mode',
    async (cancelWith) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Keep the saved note');
      const savedDocument = instance.getDocument()!;
      const before = await read();
      for (const mode of ['new', 'edit'] as const) {
        if (mode === 'new') select(buttons[1]!);
        else action(shell, { type: 'edit', id: savedDocument.annotations[0]!.id });
        action(shell, { type: 'draft', value: 'Discard this work' });
        await vi.waitFor(async () => {
          expect(shell.view.picking).toBe(true);
          expect(shell.view.editorOpen).toBe(true);
          expect((await read())?.draft.text).toBe('Discard this work');
        });
        const markers = overlay('markers').shadowRoot!;
        if (cancelWith === 'action') action(shell, { type: 'cancel-edit' });
        else if (cancelWith === 'inline') {
          [...markers.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Cancel')!
            .click();
        } else {
          markers.querySelector('textarea')!.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              composed: true,
              cancelable: true,
            }),
          );
        }
        await vi.waitFor(async () => {
          expect(shell.view).toMatchObject({
            picking: true,
            selected: [],
            draft: '',
            editingId: null,
            editorOpen: false,
            marker: null,
          });
          expect(instance.getDocument()).toEqual(savedDocument);
          expect(markers.querySelector('[role="dialog"]')).toBeNull();
          expect(markers.querySelector('[aria-label="New annotation"]')).toBeNull();
          expect(markers.querySelectorAll('.marker')).toHaveLength(1);
          const persisted = await read();
          expect(persisted?.document).toEqual(savedDocument);
          expect(persisted?.operations).toEqual(before!.operations);
          expect(persisted?.draft).toMatchObject({
            text: '',
            editingId: null,
            targets: [],
            editorOpen: false,
          });
          expect(persisted?.draft.marker).toBeUndefined();
        });
      }
    },
  );

  it('clears the active editor and its persisted draft when the inline Delete button is used', async () => {
    const { instance, shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'Delete this note');
    const note = instance.getDocument()!.annotations[0]!;
    const markers = overlay('markers').shadowRoot!;
    markers.querySelector<HTMLButtonElement>('[aria-label="Edit annotation 1"]')!.click();
    action(shell, { type: 'draft', value: 'Unsent edit to delete' });
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({ picking: true, editingId: note.id, editorOpen: true });
      expect((await read())?.draft.text).toBe('Unsent edit to delete');
    });
    [...markers.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Delete')!
      .click();
    await vi.waitFor(async () => {
      expect(instance.getDocument()!.annotations).toEqual([]);
      expect(shell.view).toMatchObject({
        picking: true,
        selected: [],
        draft: '',
        editingId: null,
        editorOpen: false,
        marker: null,
      });
      expect(markers.querySelectorAll('.marker')).toHaveLength(0);
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      const persisted = await read();
      expect(persisted?.document.annotations).toEqual([]);
      expect(persisted?.draft).toMatchObject({
        text: '',
        editingId: null,
        targets: [],
        editorOpen: false,
      });
      expect(persisted?.draft.marker).toBeUndefined();
      expect(persisted?.operations.at(-1)).toMatchObject({ kind: 'delete', annotationId: note.id });
    });
  });

  it.each(['page', 'targets'] as const)(
    'preserves the captured %s when only a saved comment is edited after geometry changes',
    async (snapshot) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Original geometry');
      const original = instance.getDocument()!.annotations[0]!;
      if (snapshot === 'page')
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(window.innerWidth + 100);
      else buttons[0]!.style.transform = 'translateY(80px)';
      action(shell, { type: 'edit', id: original.id });
      await save(shell, 'Comment only');
      await vi.waitFor(async () => {
        const revised = instance.getDocument()!.annotations[0]!;
        expect(revised.id).toBe(original.id);
        expect(revised.marker).toEqual(original.marker);
        expect(revised[snapshot]).toEqual(original[snapshot]);
        expect((await read())?.document.annotations).toEqual([revised]);
      });
    },
  );

  it.each(['new note', 'edit'] as const)(
    'restores saved notes and an unsent %s after destroy/remount',
    async (mode) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Saved note');
      const savedDocument = instance.getDocument()!;
      const note = savedDocument.annotations[0]!;
      if (mode === 'edit') action(shell, { type: 'edit', id: note.id });
      else select(buttons[1]!);
      const targets = structuredClone(shell.view.selected);
      const marker = structuredClone(shell.view.marker);
      const editingId = mode === 'edit' ? note.id : null;
      action(shell, { type: 'draft', value: 'Unsent work' });
      await vi.waitFor(async () => {
        expect((await read())?.draft).toMatchObject({
          text: 'Unsent work',
          editingId,
          targets,
          marker,
          editorOpen: true,
        });
      });
      const before = await read();

      instance.destroy();
      expect(shell.isConnected).toBe(false);
      await instance.mount();
      const restored = document.querySelector('ainotation-inspector-shell')!;
      expect(restored).not.toBe(shell);
      await vi.waitFor(async () => {
        expect(instance.getDocument()).toEqual(savedDocument);
        expect(restored.view).toMatchObject({
          draft: 'Unsent work',
          editingId,
          selected: targets,
          marker,
          editorOpen: true,
          picking: false,
        });
        expect(restored.expanded).toBe(false);
        expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
        expect(getComputedStyle(overlay('markers')).display).toBe('none');
        expect(restored.view.availability[note.targets[0]!.id]).toBe('available');
        expect(await read()).toEqual(before);
      });
      await restored.updateComplete;
      restored.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
      await vi.waitFor(async () => {
        expect(restored.view.picking).toBe(true);
        expect(restored.view.editorOpen).toBe(true);
        expect(restored.view.selected).toEqual(targets);
        expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(
          targets.length,
        );
        const markers = overlay('markers');
        expect(getComputedStyle(markers).display).toBe('block');
        expect(markers.shadowRoot!.querySelectorAll('.marker')).toHaveLength(
          mode === 'edit' ? 1 : 2,
        );
        expect(
          markers.shadowRoot!.querySelector('[aria-label="Edit annotation 1"]'),
        ).not.toBeNull();
        expect(markers.shadowRoot!.querySelector('textarea')!.value).toBe('Unsent work');
        expect(await read()).toEqual(before);
      });
    },
  );

  it('retains feedback, outbox and unsent text when clipboard access fails', async () => {
    const write = vi
      .spyOn(navigator.clipboard, 'write')
      .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const { instance, shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'Keep this feedback');
    select(buttons[1]!);
    action(shell, { type: 'draft', value: 'Keep this draft too' });
    await vi.waitFor(async () => {
      expect((await read())?.draft.text).toBe('Keep this draft too');
    });
    const before = await read();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));

    action(shell, { type: 'copy' });
    await vi.waitFor(() => {
      expect(shell.view.message).toContain('Clipboard access failed');
    });
    expect(write).toHaveBeenCalledOnce();
    const copied = await write.mock.calls[0]![0][0]!.getType('text/plain');
    expect(await copied.text()).toContain('Keep this feedback');
    expect(writeText).not.toHaveBeenCalled();
    await expect(instance.copyFeedback()).rejects.toThrow('Clipboard access failed');
    expect(instance.getDocument()).toEqual(before!.document);
    expect(shell.view.draft).toBe('Keep this draft too');
    expect(await read()).toEqual(before);
  });

  it('marks a removed saved target missing and does not rebind it to an identical replacement', async () => {
    const { instance, shell, fixture, buttons, read } = await setup();
    const original = buttons[0]!;
    select(original);
    await save(shell, 'Watch this target');
    const note = instance.getDocument()!.annotations[0]!;
    const target = note.targets[0]!;
    await vi.waitFor(async () => expect((await read())?.draft.targets).toEqual([]));
    expect(shell.view.availability[target.id]).toBe('available');

    original.replaceWith(original.cloneNode(true));
    await vi.waitFor(() => expect(shell.view.availability[target.id]).toBe('missing'));
    expect(shell.view.selected).toEqual([]);
    action(shell, { type: 'edit', id: note.id });
    expect(shell.view.selected).toEqual([target]);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.availability[target.id]).toBe('missing');
    expect(instance.getDocument()!.annotations).toEqual([note]);
    await vi.waitFor(async () => {
      expect((await read())?.draft).toMatchObject({
        targets: [target],
        editingId: note.id,
        editorOpen: true,
      });
      expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
      expect(
        overlay('markers').shadowRoot!.querySelector<HTMLButtonElement>(
          '[aria-label="Edit annotation 1"]',
        )!.title,
      ).toBe('Target unavailable');
    });

    fixture.querySelector(`#${original.id}`)!.replaceWith(original);
    await vi.waitFor(() => {
      expect(shell.view.availability[target.id]).toBe('available');
      expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(1);
    });
    expect(shell.view.selected[0]!.id).toBe(target.id);
  });

  it('saves Shift-selected targets and edits their original IDs without selecting their parent', async () => {
    const { instance, shell, buttons, read } = await setup();
    await selectMultiple(shell, buttons);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.selected.map((target) => target.selector)).toEqual(
      buttons.map((button) => `#${button.id}`),
    );
    const targetIds = shell.view.selected.map((target) => target.id);
    expect(new Set(targetIds).size).toBe(2);
    expect(shell.view.marker?.targetId).toBe(targetIds[1]);
    expect(shell.view.marker?.ratioX).toBeCloseTo(0.5, 1);
    expect(shell.view.marker?.ratioY).toBeCloseTo(0.5, 1);
    const marker = structuredClone(shell.view.marker);
    await save(shell, 'Compare these targets');
    const note = instance.getDocument()!.annotations[0]!;
    expect(note.targets.map((target) => target.id)).toEqual(targetIds);
    expect(note.marker).toEqual(marker);
    expect(shell.view.selected).toEqual([]);
    action(shell, { type: 'edit', id: note.id });
    expect(shell.view.selected.map((target) => target.id)).toEqual(targetIds);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    await vi.waitFor(async () => {
      const saved = await read();
      expect(saved?.document.annotations).toEqual([note]);
      expect(saved?.draft).toMatchObject({
        targets: note.targets,
        editingId: note.id,
        marker,
        editorOpen: true,
      });
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    select(buttons[0]!, true);
    select(buttons[1]!, true);
    select(buttons[0]!, true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({
        picking: true,
        editorOpen: true,
        editingId: null,
        draft: '',
      });
      expect(shell.view.selected.map((target) => target.id)).toEqual([targetIds[1]]);
      const saved = await read();
      expect(saved?.document.annotations).toEqual([note]);
      expect(saved?.draft.targets.map((target) => target.id)).toEqual([targetIds[1]]);
      expect(saved?.draft.marker?.targetId).toBe(targetIds[1]);
    });
  });
});
