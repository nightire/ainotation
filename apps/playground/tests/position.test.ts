import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('restores the shared dragged position after remount and refresh, including toolbar direction and a smaller viewport', async () => {
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
    const shell = page.locator('ainotation-inspector-shell');
    const launcher = shell.getByRole('button', { name: 'Open inspector', exact: true });
    const mount = async () => {
      await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
        .toBe('ready');
    };
    const unmount = async () => {
      await page.keyboard.down('Alt');
      await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
      await page.keyboard.up('Alt');
      await expect.poll(() => shell.count()).toBe(0);
    };
    await mount();
    const initial = (await shell.boundingBox())!;
    await page.mouse.move(initial.x + 24, initial.y + 24);
    await page.mouse.down();
    await page.mouse.move(112, 144, { steps: 8 });
    await page.mouse.up();
    const trigger = await shell.boundingBox();
    expect(trigger).toMatchObject({ x: 88, y: 120, width: 48, height: 48 });
    await unmount();
    await mount();
    expect(await shell.boundingBox()).toEqual(trigger);
    await launcher.click();
    const toolbar = (await shell.boundingBox())!;
    await page.mouse.move(toolbar.x + 4, toolbar.y + 20);
    await page.mouse.down();
    await page.mouse.move(toolbar.x + 644, toolbar.y + 400, { steps: 8 });
    await page.mouse.up();
    const movedToolbar = await shell.boundingBox();
    const anchor = await shell.evaluate((el) => (el as InspectorShell).getPosition()!);
    expect(anchor.opensLeft).toBe(false);
    await unmount();
    await mount();
    expect(await shell.boundingBox()).toEqual({
      x: anchor.left,
      y: anchor.top,
      width: 48,
      height: 48,
    });
    await launcher.click();
    expect(await shell.boundingBox()).toEqual(movedToolbar);
    await shell.getByRole('group', { name: 'Move inspector' }).focus();
    await page.keyboard.press('ArrowDown');
    const finalAnchor = await shell.evaluate((el) => (el as InspectorShell).getPosition()!);
    await page.reload();
    await mount();
    expect(await shell.boundingBox()).toEqual({
      x: finalAnchor.left,
      y: finalAnchor.top,
      width: 48,
      height: 48,
    });
    expect(await shell.evaluate((el) => (el as InspectorShell).expanded)).toBe(false);
    await unmount();
    await page.setViewportSize({ width: 390, height: 300 });
    await mount();
    const clamped = (await shell.boundingBox())!;
    expect(clamped.x).toBeGreaterThanOrEqual(0);
    expect(clamped.x + clamped.width).toBeLessThanOrEqual(390);
    expect(clamped.y).toBeGreaterThanOrEqual(0);
    expect(clamped.y + clamped.height).toBeLessThanOrEqual(300);
    await launcher.click();
    const expanded = (await shell.boundingBox())!;
    expect(expanded.x).toBeGreaterThanOrEqual(0);
    expect(expanded.x + expanded.width).toBeLessThanOrEqual(390);
    expect(expanded.y).toBeGreaterThanOrEqual(0);
    expect(expanded.y + expanded.height).toBeLessThanOrEqual(300);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
