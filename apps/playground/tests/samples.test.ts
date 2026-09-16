import { createPlaygroundServer, configurePage } from './helpers';
import { resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('supports nested menus and a modal with native interaction and Inspector annotations', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const menu = page.getByRole('menu', { name: 'Document actions', exact: true });
    const submenu = page.getByRole('menu', { name: 'Export formats', exact: true });
    const menuTrigger = page.getByRole('button', { name: 'Open menu', exact: true });
    await menuTrigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => menu.isVisible()).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => submenu.isVisible()).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect(await page.locator('#sample-menu-result').textContent()).toBe(
      'Selected: Export Markdown',
    );
    expect(await menu.isVisible()).toBe(false);
    await menuTrigger.click();
    await menu.getByRole('menuitem', { name: 'Export as', exact: true }).hover();
    await expect.poll(() => submenu.isVisible()).toBe(true);
    await submenu.getByRole('menuitem', { name: 'PDF', exact: true }).focus();
    await page.keyboard.press('Escape');
    expect(await submenu.isVisible()).toBe(false);
    expect(await menu.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(await menu.isVisible()).toBe(false);

    const modalTrigger = page.getByRole('button', { name: 'Open modal', exact: true });
    const dialog = page.getByRole('dialog', { name: 'Edit project', exact: true });
    await modalTrigger.click();
    await dialog.waitFor();
    expect(await page.locator('main').evaluate((el) => (el as HTMLElement).inert)).toBe(true);
    expect(
      await dialog
        .getByRole('textbox', { name: 'Project name', exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).focus();
    await page.keyboard.press('Tab');
    expect(
      await dialog
        .getByRole('button', { name: 'Close modal', exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await page.keyboard.press('Shift+Tab');
    expect(
      await dialog
        .getByRole('button', { name: 'Save changes', exact: true })
        .evaluate((el) => el === document.activeElement),
    ).toBe(true);
    await dialog
      .getByRole('textbox', { name: 'Project name', exact: true })
      .fill('Overlay samples');
    await dialog.getByRole('button', { name: 'Save changes', exact: true }).click();
    expect(await dialog.isVisible()).toBe(false);
    expect(await page.locator('main').evaluate((el) => (el as HTMLElement).inert)).toBe(false);
    expect(await page.locator('#sample-modal-result').textContent()).toBe(
      'Saved project: Overlay samples',
    );
    await modalTrigger.click();
    await page.keyboard.press('Escape');
    expect(await dialog.isVisible()).toBe(false);
    await modalTrigger.click();
    await page.locator('#sample-modal-backdrop').click({ position: { x: 10, y: 10 } });
    expect(await dialog.isVisible()).toBe(false);

    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.keyboard.down('Alt');
    await menuTrigger.click();
    await menu.getByRole('menuitem', { name: 'Export as', exact: true }).hover();
    await page.keyboard.up('Alt');
    await submenu.getByRole('menuitem', { name: 'PDF', exact: true }).click();
    const editor = page.locator('[data-ainotation-ui="markers"]').getByRole('dialog');
    await editor.waitFor();
    expect(await page.locator('#sample-menu-result').textContent()).toBe(
      'Selected: Export Markdown',
    );
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Check the submenu item');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length))
      .toBe(1);
    await page.keyboard.down('Alt');
    await modalTrigger.click();
    await page.keyboard.up('Alt');
    await dialog.getByRole('textbox', { name: 'Project name', exact: true }).click();
    await editor.waitFor();
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Check input focus in modal');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length))
      .toBe(2);
    expect(await dialog.isVisible()).toBe(true);
    await page.locator('#sample-modal-backdrop').click({ position: { x: 20, y: 80 } });
    await editor.waitFor();
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected[0]!.attributes.id),
    ).toBe('sample-modal-backdrop');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.down('Alt');
    await page.locator('#sample-modal-backdrop').click({ position: { x: 20, y: 80 } });
    await page.keyboard.up('Alt');
    expect(await dialog.isVisible()).toBe(false);
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();

    const image = page.locator('#sample-framed-image');
    const frame = page.locator('#sample-image-frame');
    await image.scrollIntoViewIfNeeded();
    expect(await image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(720);
    expect(await image.boundingBox()).toEqual(await frame.boundingBox());
    expect(await frame.evaluate((element) => getComputedStyle(element).borderTopColor)).toBe(
      'rgb(250, 174, 43)',
    );
    expect(
      await image.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2) === element;
      }),
    ).toBe(true);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await image.click();
    expect(
      await shell.evaluate(
        (element) => (element as InspectorShell).view.selected[0]!.attributes.id,
      ),
    ).toBe('sample-framed-image');
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Change the gold border to forest green.');
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    expect(
      await shell.evaluate(
        (element) => (element as InspectorShell).view.selected[0]!.attributes.id,
      ),
    ).toBe('sample-image-frame');
    expect(
      await editor.getByRole('textbox', { name: 'Feedback content', exact: true }).inputValue(),
    ).toBe('Change the gold border to forest green.');
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/parent-target-example.png'),
    });
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await image.boundingBox()).toEqual(await frame.boundingBox());
    await menuTrigger.click();
    await menu.getByRole('menuitem', { name: 'Export as', exact: true }).click();
    const child = await submenu.boundingBox();
    expect(child!.x).toBeGreaterThanOrEqual(0);
    expect(child!.x + child!.width).toBeLessThanOrEqual(390);
    await submenu.getByRole('menuitem', { name: 'Plain text', exact: true }).click();
    await modalTrigger.click();
    const bounds = await dialog.boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    expect(bounds!.height).toBeLessThanOrEqual(844);
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
