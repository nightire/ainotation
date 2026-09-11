import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('opens into selection and supports draggable launcher/panel with mouse, touch and keyboard', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    const launcher = shell.getByRole('button', { name: 'Open inspector', exact: true });
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const pending = markers.getByRole('button', { name: 'New annotation', exact: true });
    const editor = markers.getByRole('dialog');
    const draft = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    const getDocument = () => shell.evaluate((el) => (el as InspectorShell).view.document);
    await launcher.waitFor();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    const circle = await shell.boundingBox();
    expect(circle?.width).toBe(48);
    expect(circle?.height).toBe(48);
    expect(await shell.getByRole('region', { name: 'Ainotation inspector' }).isVisible()).toBe(
      false,
    );
    await page.locator('#sample-text').focus();
    await page.keyboard.press('Alt+Shift+KeyA');
    await expect.poll(() => shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await page.keyboard.press('Alt+Shift+KeyA');
    await launcher.waitFor();
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(false);
    expect(await page.locator('#sample-text').inputValue()).toBe('Ainotation');
    await page.mouse.move(circle!.x + 24, circle!.y + 24);
    await page.mouse.down();
    await page.mouse.move(114, 134, { steps: 12 });
    await page.mouse.up();
    expect(await launcher.isVisible()).toBe(true);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(false);
    const draggedCircle = await shell.boundingBox();
    expect(Math.abs(draggedCircle!.x - 90)).toBeLessThan(2);
    expect(Math.abs(draggedCircle!.y - 110)).toBeLessThan(2);
    await launcher.click();
    await expect.poll(() => shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    const header = shell.getByRole('group', { name: 'Move inspector' });
    const headerBox = await header.boundingBox();
    const panelBox = await shell.boundingBox();
    expect(panelBox!.x).toBeCloseTo(draggedCircle!.x, 0);
    expect(panelBox!.y + panelBox!.height).toBeCloseTo(draggedCircle!.y + draggedCircle!.height, 0);
    const dx = panelBox!.x > 160 ? -130 : 130;
    const dy = panelBox!.y > 80 ? -50 : 50;
    await page.mouse.move(headerBox!.x + 4, headerBox!.y + 20);
    await page.mouse.down();
    await page.mouse.move(headerBox!.x + 4 + dx, headerBox!.y + 20 + dy, { steps: 12 });
    await page.mouse.up();
    const movedPanel = await shell.boundingBox();
    expect(Math.abs(movedPanel!.x - panelBox!.x - dx)).toBeLessThan(2);
    expect(Math.abs(movedPanel!.y - panelBox!.y - dy)).toBeLessThan(2);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await launcher.waitFor();
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(false);
    expect(await shell.boundingBox()).toEqual({
      ...draggedCircle!,
      x: draggedCircle!.x + dx,
      y: draggedCircle!.y + dy,
    });
    expect(await page.locator('#mount-status').innerText()).toBe('Mounted');
    // Keyboard opening is a real native button activation after a completed drag.
    await launcher.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    expect(await shell.boundingBox()).toEqual(movedPanel);
    expect(await shell.getByRole('checkbox', { name: 'Multiple', exact: true }).count()).toBe(0);
    expect(await shell.getByRole('button', { name: 'Select element', exact: true }).count()).toBe(
      0,
    );
    const output = page.locator('#sample-output');
    const outputBox = await output.boundingBox();
    await output.click({ position: { x: 20, y: 15 } });
    await markers.getByRole('dialog', { name: 'New feedback', exact: true }).waitFor();
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    const pendingBox = (await pending.boundingBox())!;
    expect(Math.abs(pendingBox.x + pendingBox.width / 2 - outputBox!.x - 20)).toBeLessThan(1);
    expect(Math.abs(pendingBox.y + pendingBox.height / 2 - outputBox!.y - 15)).toBeLessThan(1);
    await draft.fill('Cancel this new feedback.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect(await pending.count()).toBe(0);
    expect((await getDocument())?.annotations).toHaveLength(0);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await page.locator('#sample-heading').click({ position: { x: 60, y: 10 } });
    await draft.fill('Escape cancels this draft too.');
    await page.keyboard.press('Escape');
    await editor.waitFor({ state: 'detached' });
    expect(await pending.count()).toBe(0);
    expect((await getDocument())?.annotations).toHaveLength(0);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    for (const overSelected of [true, false]) {
      await page.keyboard.down('Shift');
      await page.locator('#sample-heading').click({ position: { x: 20, y: 10 } });
      await output.click({ position: { x: 20, y: 15 } });
      const firstBox = (await page.locator('#sample-heading').boundingBox())!;
      await page.mouse.move(
        overSelected ? firstBox.x + 80 : 10,
        overSelected ? firstBox.y + 10 : 10,
      );
      await page.keyboard.up('Shift');
      await editor.waitFor();
      const anchor = (await pending.boundingBox())!;
      const lastBox = (await output.boundingBox())!;
      expect(anchor.x + 12).toBeCloseTo(
        overSelected ? firstBox.x + 80 : lastBox.x + lastBox.width,
        0,
      );
      expect(anchor.y + 12).toBeCloseTo(
        overSelected ? firstBox.y + 10 : lastBox.y + lastBox.height,
        0,
      );
      expect(await editor.locator('.target-list li').count()).toBe(2);
      expect(await editor.locator('h2, label').count()).toBe(0);
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await editor.waitFor({ state: 'detached' });
    }
    await page.keyboard.down('Shift');
    await page.locator('#sample-heading').click({ position: { x: 20, y: 10 } });
    expect(await editor.count()).toBe(0);
    await output.click({ position: { x: 20, y: 15 } });
    expect(await editor.count()).toBe(0);
    expect(await pending.count()).toBe(0);
    expect(
      await shell.evaluate((el) =>
        (el as InspectorShell).view.selected.map((target) => target.selector),
      ),
    ).toEqual(['#sample-heading', '#sample-output']);
    await page.keyboard.up('Shift');
    await markers.getByRole('dialog', { name: 'New feedback', exact: true }).waitFor();
    const batchBox = (await pending.boundingBox())!;
    const lastTarget = (await output.boundingBox())!;
    expect(Math.abs(batchBox.x + batchBox.width / 2 - lastTarget.x - 20)).toBeLessThan(1);
    expect(Math.abs(batchBox.y + batchBox.height / 2 - lastTarget.y - 15)).toBeLessThan(1);
    const originalComment = 'Saved feedback survives closing and remounting.';
    await draft.fill(originalComment);
    await draft.press('Meta+Enter');
    const savedMarker = markers.getByRole('button', { name: 'Edit annotation 1', exact: true });
    await savedMarker.waitFor();
    await editor.waitFor({ state: 'detached' });
    const savedId = await savedMarker.getAttribute('data-annotation-id');
    const savedBox = (await savedMarker.boundingBox())!;
    expect((await getDocument())?.annotations[0]?.targets).toHaveLength(2);
    await shell.getByRole('group', { name: 'Move inspector' }).focus();
    await page.mouse.move(10, 10);
    expect(await savedMarker.locator('.number').isVisible()).toBe(true);
    expect(await savedMarker.locator('.pencil').isVisible()).toBe(false);
    await savedMarker.hover();
    expect(await savedMarker.locator('.number').isVisible()).toBe(false);
    expect(await savedMarker.locator('.pencil').isVisible()).toBe(true);
    await savedMarker.click();
    await markers.getByRole('dialog', { name: 'Edit feedback', exact: true }).waitFor();
    expect(await draft.inputValue()).toBe(originalComment);
    await draft.fill('Discard this edit.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect((await getDocument())?.annotations[0]?.comment).toBe(originalComment);
    await savedMarker.click();
    const savedComment = 'Updated feedback survives closing and remounting.';
    await draft.fill(savedComment);
    await draft.press('Meta+Enter');
    await expect
      .poll(async () => (await getDocument())?.annotations[0]?.comment)
      .toBe(savedComment);
    await editor.waitFor({ state: 'detached' });
    expect(await savedMarker.getAttribute('data-annotation-id')).toBe(savedId);
    expect((await getDocument())?.annotations).toHaveLength(1);
    await page.locator('#sample-heading').click({ position: { x: 120, y: 10 } });
    await draft.fill('Preserve this draft while moving and minimizing.');
    const selectedIds = await shell.evaluate((el) =>
      (el as InspectorShell).view.selected.map((target) => target.id),
    );
    expect(selectedIds).toHaveLength(1);
    const draftAnchor = await shell.evaluate((el) => (el as InspectorShell).view.marker);
    await page.keyboard.press('Alt+Shift+KeyA');
    await launcher.waitFor();
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected.map((target) => target.id)),
    ).toEqual(selectedIds);
    expect(await page.locator('[data-ainotation-ui="selection"] .rect').count()).toBe(0);
    expect(await markers.isVisible()).toBe(false);
    expect(await editor.isVisible()).toBe(false);
    await launcher.click();
    await editor.waitFor();
    expect(await draft.inputValue()).toBe('Preserve this draft while moving and minimizing.');
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected.map((target) => target.id)),
    ).toEqual(selectedIds);
    expect(await pending.isVisible()).toBe(true);
    expect(await savedMarker.isVisible()).toBe(true);
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.keyboard.press('Escape');
    expect(await shell.getByRole('dialog', { name: 'Inspector settings' }).isVisible()).toBe(false);
    expect(await editor.isVisible()).toBe(true);
    expect(await draft.inputValue()).toBe('Preserve this draft while moving and minimizing.');
    await header.focus();
    const beforeKey = await shell.boundingBox();
    await page.keyboard.press('ArrowRight');
    expect((await shell.boundingBox())!.x).toBe(beforeKey!.x + 10);
    await page.setViewportSize({ width: 390, height: 600 });
    await expect
      .poll(() =>
        shell.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        }),
      )
      .toBe(true);
    // The mobile draft can overlap the panel; the global shortcut preserves it while closing.
    await page.keyboard.press('Alt+Shift+KeyA');
    await launcher.waitFor();
    const minimized = await shell.boundingBox();
    await page.mouse.move(minimized!.x + 24, minimized!.y + 24);
    await page.mouse.down();
    await page.mouse.move(360, 560, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
    await expect.poll(() => page.locator('[data-ainotation-ui]').count()).toBe(0);
    await page.keyboard.press('Alt+Shift+KeyA');
    expect(await page.locator('ainotation-inspector-shell').count()).toBe(0);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected.map((target) => target.id)),
    ).toEqual(selectedIds);
    expect(
      (await getDocument())?.annotations.map((annotation) => ({
        id: annotation.id,
        comment: annotation.comment,
      })),
    ).toEqual([{ id: savedId, comment: savedComment }]);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.marker)).toEqual(draftAnchor);
    expect(await markers.isVisible()).toBe(false);
    expect(await page.locator('[data-ainotation-ui="selection"] .rect').count()).toBe(0);
    await launcher.click();
    await editor.waitFor();
    expect(await pending.isVisible()).toBe(true);
    expect(await savedMarker.getAttribute('data-annotation-id')).toBe(savedId);
    expect(await draft.inputValue()).toBe('Preserve this draft while moving and minimizing.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await savedMarker.click();
    expect(await draft.inputValue()).toBe(savedComment);
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(async () => (await getDocument())?.annotations.length).toBe(0);
    await savedMarker.waitFor({ state: 'detached' });
    await editor.waitFor({ state: 'detached' });
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
    expect(errors).toEqual([]);

    const touchContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const touchPage = await touchContext.newPage();
    configurePage(touchPage, errors);
    await touchPage.goto(origin);
    await touchPage.getByRole('button', { name: 'Mount inspector', exact: true }).tap();
    const touchShell = touchPage.locator('ainotation-inspector-shell');
    const touchLauncher = touchShell.getByRole('button', { name: 'Open inspector', exact: true });
    await touchLauncher.waitFor();
    await expect
      .poll(() => touchShell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    const cdp = await touchContext.newCDPSession(touchPage);
    const start = await touchShell.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: start!.x + 24, y: start!.y + 24 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 64, y: 104 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(await touchLauncher.isVisible()).toBe(true);
    const touchPosition = await touchShell.boundingBox();
    expect(Math.abs(touchPosition!.x - 40)).toBeLessThan(2);
    expect(Math.abs(touchPosition!.y - 80)).toBeLessThan(2);
    await touchLauncher.tap();
    await expect
      .poll(() => touchShell.evaluate((el) => (el as InspectorShell).view.picking))
      .toBe(true);
    const touchHeader = await touchShell
      .getByRole('group', { name: 'Move inspector' })
      .boundingBox();
    const beforeTouchPanel = await touchShell.boundingBox();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: touchHeader!.x + 4, y: touchHeader!.y + 20 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: touchHeader!.x + 4, y: touchHeader!.y + 140 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    expect(Math.abs((await touchShell.boundingBox())!.y - beforeTouchPanel!.y - 120)).toBeLessThan(
      2,
    );
    const movedTouchToolbar = await touchShell.boundingBox();
    await touchShell.getByRole('button', { name: 'Close inspector', exact: true }).tap();
    expect(await touchShell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(false);
    const foldedTouch = await touchShell.boundingBox();
    expect(foldedTouch!.x).toBe(movedTouchToolbar!.x);
    expect(foldedTouch!.y + foldedTouch!.height).toBe(
      movedTouchToolbar!.y + movedTouchToolbar!.height,
    );
    await touchLauncher.tap();
    expect(await touchShell.boundingBox()).toEqual(movedTouchToolbar);
    await touchShell.getByRole('button', { name: 'Close inspector', exact: true }).tap();
    await touchPage.getByRole('button', { name: 'Unmount inspector', exact: true }).tap();
    await expect.poll(() => touchPage.locator('[data-ainotation-ui]').count()).toBe(0);
    expect(errors).toEqual([]);
    expect([pendingBox, savedBox].map(({ width, height }) => ({ width, height }))).toEqual([
      { width: 24, height: 24 },
      { width: 24, height: 24 },
    ]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
