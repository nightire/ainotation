import { chromium } from 'playwright';
import { resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { createPlaygroundServer, configurePage } from './helpers';

it('restores a hidden modal preview and preserves the editor context through save, reopen and reload', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: 1440, height: 1000 },
      hasTouch: true,
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const shell = page.locator('ainotation-inspector-shell'),
      markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog'),
      cancel = page.locator('#sample-modal-cancel'),
      row = page.locator('.dialog-actions');
    const mount = async () => {
      await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
        .toBe('ready');
    };
    const padding = () => cancel.evaluate((el) => getComputedStyle(el).paddingRight);
    const alignment = () => row.evaluate((el) => getComputedStyle(el).justifyContent);
    await mount();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.keyboard.down('Alt');
    await page.locator('#sample-modal-trigger').click();
    await page.keyboard.up('Alt');
    await cancel.click();
    expect(
      await editor.locator('[data-action="close-edit"], [data-action="panel-drag"]').count(),
    ).toBe(0);
    const feedback = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    await feedback.fill('Keep this text while moving the panel');
    const fixed = (await editor.boundingBox())!,
      textbox = (await feedback.boundingBox())!;
    await page.mouse.move(textbox.x + 10, textbox.y + 16);
    await page.mouse.down();
    await page.mouse.move(textbox.x + 90, textbox.y + 16, { steps: 5 });
    await page.mouse.up();
    expect((await editor.boundingBox())!.x).toBeCloseTo(fixed.x, 1);
    expect((await editor.boundingBox())!.y).toBeCloseTo(fixed.y, 1);
    expect(
      await feedback.evaluate(
        (el) =>
          (el as HTMLTextAreaElement).selectionStart! < (el as HTMLTextAreaElement).selectionEnd!,
      ),
    ).toBe(true);
    await editor.getByRole('tab', { name: 'Styles', exact: true }).click();
    await editor.getByRole('button', { name: 'Padding: Individual sides', exact: true }).click();
    await editor.getByRole('textbox', { name: 'Right padding', exact: true }).fill('16px');
    await editor.getByRole('textbox', { name: 'Left padding', exact: true }).fill('16px');
    const before = (await editor.boundingBox())!;
    await page.mouse.move(before.x + 5, before.y + 5);
    await page.mouse.down();
    await page.mouse.move(1085, 145, { steps: 8 });
    await page.mouse.up();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.editorPosition?.x))
      .toBeCloseTo(1080, 0);
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: 1085, y: 145 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 1105, y: 165 }],
    });
    await expect.poll(async () => (await editor.boundingBox())!.x).toBeCloseTo(1100, 0);
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: 1085, y: 145 }],
    });
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await touch.detach();
    await expect.poll(async () => (await editor.boundingBox())!.x).toBeCloseTo(1080, 0);
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    await editor.getByText('Layout', { exact: true }).click();
    await editor
      .getByRole('combobox', { name: 'Main-axis alignment', exact: true })
      .selectOption('flex-start');
    await editor.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/navigation-before-save.png'),
    });
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const note = await shell.evaluate(
      (el) => (el as InspectorShell).view.document!.annotations[0]!,
    );
    const parentId = note.targets.find((target) => target.selector === '.dialog-actions')!.id;
    const childId = note.targets.find(
      (target) => target.attributes.id === 'sample-modal-cancel',
    )!.id;
    expect(note.targets).toHaveLength(2);
    expect(await padding()).toBe('16px');
    expect(await alignment()).toBe('flex-start');
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    expect(await editor.getByRole('tab', { name: /Styles/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const scope = editor.getByRole('combobox', { name: 'Editing target', exact: true });
    expect(await scope.count()).toBe(0);
    expect(await editor.locator('.target-list > li').count()).toBe(1);
    expect(await editor.locator('.target-locator code').textContent()).toBe('.dialog-actions');
    expect((await editor.boundingBox())!.x).toBeCloseTo(1080, 0);
    expect((await editor.boundingBox())!.y).toBeCloseTo(140, 0);
    await editor.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/navigation-after-reopen.png'),
    });
    await editor.getByRole('button', { name: 'Return to previous element', exact: true }).click();
    expect(await editor.locator('.target-locator code').textContent()).toBe('#sample-modal-cancel');
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected.map((target) => target.id)),
    ).toEqual([childId]);
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected.map((target) => target.id)),
    ).toEqual([parentId]);
    expect(await scope.count()).toBe(0);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await page.reload();
    await mount();
    expect(await page.locator('#sample-modal-overlay').isVisible()).toBe(false);
    await page.locator('#sample-modal-trigger').click();
    // No inspector/marker interaction is needed to recover the initially hidden targets.
    await expect.poll(padding).toBe('16px');
    await expect.poll(alignment).toBe('flex-start');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    expect(await editor.getByRole('tab', { name: /Styles/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await scope.count()).toBe(0);
    expect(await editor.locator('.target-list > li').count()).toBe(1);
    await editor.getByRole('button', { name: 'Return to previous element', exact: true }).click();
    expect(await editor.locator('.target-locator code').textContent()).toBe('#sample-modal-cancel');
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    expect(await editor.locator('.target-locator code').textContent()).toBe('.dialog-actions');
    expect((await editor.boundingBox())!.x).toBeCloseTo(1080, 0);
    expect((await editor.boundingBox())!.y).toBeCloseTo(140, 0);
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.styleEditor.problem),
    ).toBeNull();
    await page.locator('#sample-modal-backdrop').click({ position: { x: 10, y: 20 } });
    await editor.waitFor({ state: 'detached' });
    expect(await page.locator('#sample-modal-overlay').isVisible()).toBe(true);
    expect(await markers.getByRole('button', { name: 'New annotation', exact: true }).count()).toBe(
      0,
    );
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length),
    ).toBe(1);
    expect(await padding()).toBe('16px');
    expect(await alignment()).toBe('flex-start');
    await page.locator('#sample-modal-backdrop').click({ position: { x: 10, y: 20 } });
    await markers.getByRole('button', { name: 'New annotation', exact: true }).waitFor();
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected[0]!.attributes.id),
    ).toBe('sample-modal-backdrop');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
