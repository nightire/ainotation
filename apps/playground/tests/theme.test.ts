import { resolve } from 'node:path';
import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('switches all Inspector surfaces, preserves feedback and restores theme after remount and refresh', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      colorScheme: 'dark',
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog');
    const mount = async () => {
      await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
        .toBe('ready');
    };
    await mount();
    expect(await shell.getAttribute('data-theme')).toBe('light');
    const pageBackground = await page
      .locator('html')
      .evaluate((el) => getComputedStyle(el).backgroundColor);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.locator('#sample-heading').click({ position: { x: 20, y: 10 } });
    const input = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    await input.fill('Keep this feedback through theme changes');
    const originalTargets = await shell.evaluate((el) => (el as InspectorShell).view.selected);
    const originalInput = await input.elementHandle();
    const lightSurface = await editor.evaluate((el) => getComputedStyle(el).backgroundColor);
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await shell.evaluate(async (el) => {
      await Promise.allSettled(
        el
          .shadowRoot!.querySelector('header')!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/theme-light.png'),
      scale: 'css',
    });
    await shell.getByRole('button', { name: 'Theme: Light', exact: true }).click();
    await expect.poll(() => markers.getAttribute('data-theme')).toBe('dark');
    const darkSurface = await editor.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkSurface).not.toBe(lightSurface);
    expect(
      await shell.locator('.settings').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(darkSurface);
    expect(
      await shell.locator('.toolbar').evaluate((el) => getComputedStyle(el).backgroundColor),
    ).toBe(darkSurface);
    expect(await input.evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
    expect(await input.inputValue()).toBe('Keep this feedback through theme changes');
    expect(await originalInput!.evaluate((el) => el.isConnected)).toBe(true);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.selected)).toEqual(
      originalTargets,
    );
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      pageBackground,
    );
    await shell.evaluate(async (el) => {
      await Promise.allSettled(
        el
          .shadowRoot!.querySelector('header')!
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      );
    });
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/theme-dark.png'),
      scale: 'css',
    });
    await input.press('Meta+Enter');
    await editor.waitFor({ state: 'detached' });
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length))
      .toBe(1);
    const saved = await shell.evaluate((el) => (el as InspectorShell).view.document!);
    await shell.getByRole('button', { name: 'Theme: Dark', exact: true }).click();
    await shell.getByRole('button', { name: 'Theme: Light', exact: true }).click();
    expect(await shell.evaluate((el) => (el as InspectorShell).view.document)).toEqual(saved);
    await page.keyboard.down('Alt');
    await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
    await page.keyboard.up('Alt');
    await mount();
    await expect.poll(() => shell.getAttribute('data-theme')).toBe('dark');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    expect(await editor.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(darkSurface);
    expect(await input.inputValue()).toBe(saved.annotations[0]!.comment);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await page.reload();
    await mount();
    await expect.poll(() => shell.getAttribute('data-theme')).toBe('dark');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await shell.getByRole('button', { name: 'Theme: Dark', exact: true }).click();
    await expect.poll(() => markers.getAttribute('data-theme')).toBe('light');
    expect(await editor.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(lightSurface);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.document)).toEqual(saved);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
