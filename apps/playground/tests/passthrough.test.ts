import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium, type Locator, type Page } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

async function withPicker(run: (page: Page) => Promise<void>) {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'passthrough-fixture';
      fixture.style.cssText =
        'position:fixed;left:40px;top:100px;width:240px;z-index:100;background:white;display:grid;gap:8px;';
      fixture.innerHTML = `
        <style>
          #passthrough-fixture :is(input,textarea,button) {
            box-sizing:border-box;display:block;width:240px;height:30px;min-height:0;
            margin:0;padding:2px;border:1px solid black;font:12px sans-serif;
            outline:none;box-shadow:none;
          }
          #passthrough-fixture .passthrough-field:focus {
            outline:3px solid teal;box-shadow:0 0 0 5px rgb(17, 93, 101);
          }
          #passthrough-menu[hidden] { display:none; }
        </style>
        <input id="passthrough-input" class="passthrough-field" aria-label="Passthrough input">
        <textarea id="passthrough-textarea" class="passthrough-field" aria-label="Passthrough textarea"></textarea>
        <button id="passthrough-toggle" aria-expanded="false" aria-controls="passthrough-menu">Open choices</button>
        <div id="passthrough-menu" role="menu" hidden>
          <button id="passthrough-option" role="menuitem">Choose item</button>
        </div>
        <button id="passthrough-action">Host action</button>
        <button id="passthrough-other">Other host action</button>
      `;
      for (const control of fixture.querySelectorAll('input,textarea,button')) {
        control.setAttribute('data-clicks', '0');
        control.setAttribute('data-inputs', '0');
        for (const type of ['click', 'input']) {
          control.addEventListener(type, () => {
            const attribute = `data-${type}s`;
            control.setAttribute(attribute, String(Number(control.getAttribute(attribute)) + 1));
          });
        }
      }
      const toggle = fixture.querySelector('#passthrough-toggle')!;
      const menu = fixture.querySelector<HTMLElement>('#passthrough-menu')!;
      toggle.addEventListener('click', () => {
        menu.hidden = !menu.hidden;
        toggle.setAttribute('aria-expanded', String(!menu.hidden));
      });
      fixture.querySelector('#passthrough-option')!.addEventListener('click', () => {
        menu.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
      });
      document.body.append(fixture);
    });
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(() => shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Missing passthrough control bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

it('passes native focus, input and menu events through Alt and preserves picked snapshots and saved markers', async () => {
  await withPicker(async (page) => {
    const shell = page.locator('ainotation-inspector-shell');
    const view = () => shell.evaluate((el) => (el as InspectorShell).view);
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog', { name: 'New feedback', exact: true });
    const draft = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    const input = page.locator('#passthrough-input');
    const textarea = page.locator('#passthrough-textarea');
    const toggle = page.locator('#passthrough-toggle');
    const option = page.locator('#passthrough-option');
    const menu = page.locator('#passthrough-menu');
    const inputPoint = await center(input);
    const click = async (locator: Locator) => {
      const point = await center(locator);
      await page.mouse.click(point.x, point.y);
    };
    const initialDocument = (await view()).document;

    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    for (const [field, text] of [
      [input, 'Native input text'],
      [textarea, 'Native textarea text'],
    ] as const) {
      await click(field);
      expect(await field.evaluate((el) => el === document.activeElement)).toBe(true);
      await field.fill(text);
      expect(await field.inputValue()).toBe(text);
      expect(await field.getAttribute('data-clicks')).toBe('1');
      expect(await field.getAttribute('data-inputs')).toBe('1');
      expect(await view()).toMatchObject({
        picking: true,
        passthrough: true,
        selected: [],
        editorOpen: false,
        document: initialDocument,
      });
      expect(await markers.getByRole('dialog').count()).toBe(0);
      expect(
        await markers.getByRole('button', { name: 'New annotation', exact: true }).count(),
      ).toBe(0);
    }
    await click(input);
    const focusedStyles = await input.evaluate((el) => ({
      outline: getComputedStyle(el).outline,
      'box-shadow': getComputedStyle(el).boxShadow,
    }));
    expect(focusedStyles.outline).toBe('rgb(0, 128, 128) solid 3px');
    expect(focusedStyles['box-shadow']).toBe('rgb(17, 93, 101) 0px 0px 0px 5px');
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(false);
    await page.mouse.click(inputPoint.x, inputPoint.y);
    await editor.waitFor();
    await expect.poll(() => draft.evaluate((el) => el.matches(':focus'))).toBe(true);
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(false);
    expect(await input.evaluate((el) => getComputedStyle(el).boxShadow)).toBe('none');
    expect(await input.getAttribute('data-clicks')).toBe('2');
    const selected = (await view()).selected;
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      selector: '#passthrough-input',
      states: { focused: true, focusWithin: true },
      styles: focusedStyles,
    });
    expect((await view()).picking).toBe(true);
    await draft.fill('Retain the focused field appearance.');
    expect((await view()).selected).toEqual(selected);
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const savedMarker = markers.getByRole('button', { name: 'Edit annotation 1', exact: true });
    await savedMarker.waitFor();
    const savedDocument = (await view()).document!;
    expect(savedDocument.annotations).toHaveLength(1);
    expect(savedDocument.annotations[0]).toMatchObject({ targets: selected });
    const markerId = await savedMarker.getAttribute('data-annotation-id');
    expect(markerId).toBe(savedDocument.annotations[0]!.id);
    const markerPoint = await center(savedMarker);
    expect(markerPoint.x).toBeCloseTo(inputPoint.x, 0);
    expect(markerPoint.y).toBeCloseTo(inputPoint.y, 0);
    const afterSaveSelection = (await view()).selected;

    // Hit the saved marker's exact center; Alt must expose the native input beneath it.
    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    await expect
      .poll(() => savedMarker.evaluate((el) => getComputedStyle(el).pointerEvents))
      .toBe('none');
    await page.mouse.click(inputPoint.x, inputPoint.y);
    expect(await input.evaluate((el) => el === document.activeElement)).toBe(true);
    expect(await input.getAttribute('data-clicks')).toBe('3');
    expect(await markers.getByRole('dialog').count()).toBe(0);
    expect(await view()).toMatchObject({
      picking: true,
      editorOpen: false,
      selected: afterSaveSelection,
    });
    expect((await view()).document).toEqual(savedDocument);
    expect(await savedMarker.getAttribute('data-annotation-id')).toBe(markerId);
    expect(await savedMarker.locator('.number').innerText()).toBe('1');

    await click(toggle);
    expect(await menu.isVisible()).toBe(true);
    expect(await toggle.getAttribute('aria-expanded')).toBe('true');
    expect(await toggle.getAttribute('data-clicks')).toBe('1');
    expect(await view()).toMatchObject({
      picking: true,
      passthrough: true,
      editorOpen: false,
      selected: afterSaveSelection,
    });
    expect((await view()).document).toEqual(savedDocument);
    expect(await markers.getByRole('dialog').count()).toBe(0);
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(false);
    await click(option);
    await editor.waitFor();
    expect((await view()).selected).toMatchObject([
      { selector: '#passthrough-option', tagName: 'button' },
    ]);
    expect((await view()).selected).toHaveLength(1);
    expect(await option.getAttribute('data-clicks')).toBe('0');
    expect(await menu.isVisible()).toBe(true);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await click(toggle);
    await editor.waitFor();
    expect((await view()).selected).toMatchObject([
      { selector: '#passthrough-toggle', attributes: { 'aria-expanded': 'true' } },
    ]);
    expect(await toggle.getAttribute('data-clicks')).toBe('1');
    expect(await menu.isVisible()).toBe(true);
    await draft.fill('Capture the expanded dropdown.');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await markers.getByRole('button', { name: 'Edit annotation 2', exact: true }).waitFor();
    const annotations = (await view()).document!.annotations;
    expect(annotations).toHaveLength(2);
    expect(annotations[0]).toEqual(savedDocument.annotations[0]);
    expect(annotations[1]!.targets).toMatchObject([
      { selector: '#passthrough-toggle', attributes: { 'aria-expanded': 'true' } },
    ]);
    expect((await view()).picking).toBe(true);
  });
});

it('latches Alt gestures, skips Shift batches and resets passthrough across closing and blur', async () => {
  await withPicker(async (page) => {
    const shell = page.locator('ainotation-inspector-shell');
    const view = () => shell.evaluate((el) => (el as InspectorShell).view);
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog', { name: 'New feedback', exact: true });
    const action = page.locator('#passthrough-action');
    const other = page.locator('#passthrough-other');
    const point = await center(action);
    const initialDocument = (await view()).document;
    const expectNoPick = async (passthrough: boolean, picking = true) => {
      expect(await view()).toMatchObject({ picking, passthrough, editorOpen: false, selected: [] });
      expect((await view()).document).toEqual(initialDocument);
      expect(await markers.getByRole('dialog').count()).toBe(0);
      expect(
        await markers.getByRole('button', { name: 'New annotation', exact: true }).count(),
      ).toBe(0);
    };

    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.keyboard.up('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(false);
    await page.mouse.up();
    expect(await action.getAttribute('data-clicks')).toBe('1');
    await expectNoPick(false);
    await page.mouse.click(point.x, point.y);
    await editor.waitFor();
    expect((await view()).selected).toHaveLength(1);
    expect((await view()).selected[0]!.selector).toBe('#passthrough-action');
    expect(await action.getAttribute('data-clicks')).toBe('1');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expectNoPick(false);

    await page.keyboard.down('Shift');
    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    for (const control of [action, other]) {
      const target = await center(control);
      await page.mouse.click(target.x, target.y);
      await expectNoPick(true);
    }
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await expectNoPick(false);
    expect(await action.getAttribute('data-clicks')).toBe('2');
    expect(await other.getAttribute('data-clicks')).toBe('1');

    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    await page.keyboard.down('Shift');
    await page.keyboard.press('KeyA');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).waitFor();
    await expectNoPick(false, false);
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');
    await expectNoPick(false, false);
    await page.mouse.click(point.x, point.y);
    expect(await action.getAttribute('data-clicks')).toBe('3');
    await expectNoPick(false, false);
    await page.keyboard.up('Alt');
    await page.keyboard.press('Alt+Shift+KeyA');
    await expect.poll(async () => (await view()).picking).toBe(true);
    await expectNoPick(false);

    await page.keyboard.down('Alt');
    await expect.poll(async () => (await view()).passthrough).toBe(true);
    await page.mouse.click(point.x, point.y);
    expect(await action.getAttribute('data-clicks')).toBe('4');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await expect.poll(async () => (await view()).passthrough).toBe(false);
    await page.keyboard.up('Alt');
    await expectNoPick(false);
    const field = await center(page.locator('#passthrough-textarea'));
    await page.mouse.click(field.x, field.y);
    await editor.waitFor();
    expect(await view()).toMatchObject({ picking: true, passthrough: false, editorOpen: true });
    expect((await view()).selected).toHaveLength(1);
    expect((await view()).selected[0]!.selector).toBe('#passthrough-textarea');
    expect(await page.locator('#passthrough-textarea').getAttribute('data-clicks')).toBe('0');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expectNoPick(false);
  });
});
