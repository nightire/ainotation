import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { build, preview } from 'vite-plus';
import { chromium } from 'playwright';
import { expect, it } from 'vite-plus/test';

it('serves the Pages build, switches appearance and language, and runs a local SDK demo', async () => {
  const root = resolve(import.meta.dirname, '..');
  await build({ root, logLevel: 'silent' });
  const web = await preview({
    root,
    base: '/ainotation/',
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 0 },
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const address = web.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Missing preview address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: 'light',
      locale: 'en-US',
    });
    const errors: string[] = [];
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.setDefaultTimeout(7000);
    const response = await page.goto(`http://127.0.0.1:${address.port}/ainotation/`, {
      waitUntil: 'networkidle',
    });
    expect(response?.status()).toBe(200);
    await page.evaluate(() => document.fonts.ready);
    expect(await page.locator('.title-first').textContent()).toBe('A note.');
    expect(await page.locator('.title-second').textContent()).toBe('In its place.');
    expect(await page.locator('html').getAttribute('data-theme')).toBe('light');
    for (const brand of ['.site-header .brand-mark', '.footer-brand .brand-mark']) {
      expect(await page.locator(`${brand} .logo-light`).isVisible()).toBe(true);
      expect(await page.locator(`${brand} .logo-dark`).isVisible()).toBe(false);
      expect(
        await page
          .locator(`${brand} img`)
          .evaluateAll((images) =>
            images.every(
              (image) =>
                (image as HTMLImageElement).complete &&
                (image as HTMLImageElement).naturalWidth === 256,
            ),
          ),
      ).toBe(true);
    }
    const faviconUrl = await page
      .locator('link[rel="icon"][type="image/svg+xml"]')
      .getAttribute('href');
    expect(faviconUrl).toBe('/ainotation/favicon.svg');
    expect((await page.request.get(new URL(faviconUrl!, page.url()).href)).status()).toBe(200);
    for (const size of [16, 24, 32, 48]) {
      const asset = await page.request.get(new URL(`favicon-${size}.png`, page.url()).href);
      expect(asset.status()).toBe(200);
      const png = await asset.body();
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-light.png'),
      fullPage: true,
    });
    await page.locator('#tab-draw').click();
    expect(await page.locator('#product-preview').getAttribute('data-mode')).toBe('draw');
    await page.locator('#tab-draw').press('ArrowRight');
    expect(await page.locator('.handoff-card').isVisible()).toBe(true);
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-handoff.png'),
      fullPage: true,
      animations: 'disabled',
    });
    await page.locator('#tab-select').click();
    await page.locator('#theme-toggle').click();
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    for (const brand of ['.site-header .brand-mark', '.footer-brand .brand-mark']) {
      expect(await page.locator(`${brand} .logo-dark`).isVisible()).toBe(true);
      expect(await page.locator(`${brand} .logo-light`).isVisible()).toBe(false);
    }
    expect(await page.locator('link[rel="icon"][type="image/svg+xml"]').getAttribute('href')).toBe(
      faviconUrl,
    );
    expect(
      await page.locator('body').evaluate((element) => getComputedStyle(element).backgroundColor),
    ).toBe('rgb(0, 70, 67)');
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-dark.png'),
      fullPage: true,
    });
    await page.reload({ waitUntil: 'networkidle' });
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
    await page.locator('#language-toggle').click();
    expect(await page.locator('html').getAttribute('lang')).toBe('zh-CN');
    expect(
      await page
        .locator('[data-i18n]')
        .evaluateAll((elements) =>
          elements.every((element) => Boolean(element.textContent?.trim())),
        ),
    ).toBe(true);
    expect(await page.locator('.title-first').textContent()).toBe('一条批注。');
    expect(await page.locator('.title-second').textContent()).toBe('恰在此处。');
    await page.locator('#theme-toggle').click();
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-zh.png'),
      fullPage: true,
    });
    // Copy is a user-triggered operation; inspect its payload without requiring clipboard permission.
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.copied = text;
          },
        },
      });
    });
    await page.locator('[data-copy="mcp-code"]').click();
    expect(JSON.parse((await page.locator('html').getAttribute('data-copied'))!)).toMatchObject({
      mcpServers: {
        ainotation: { command: 'npx', args: ['--yes', '@ainotation/mcp@beta', 'connect'] },
      },
    });
    await page.locator('#language-toggle').click();
    const mcpRequests: string[] = [];
    await page.route('http://127.0.0.1:4748/**', async (route) => {
      mcpRequests.push(route.request().url());
      await route.abort();
    });
    await page.evaluate(() =>
      sessionStorage.setItem(
        'ainotation:mcp:ainotation-website-demo',
        JSON.stringify({ endpoint: 'http://127.0.0.1:4748', token: 'previous-demo-test-token' }),
      ),
    );
    await page.locator('#try-demo').click();
    const shell = page.locator('ainotation-inspector-shell');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).waitFor();
    expect(await shell.count()).toBe(1);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await shell.locator('.local-mode').textContent()).toBe('Local only');
    expect(await shell.locator('.connection-form, .connection-status').count()).toBe(0);
    await shell.locator('#inspector-settings').screenshot({
      path: resolve(root, '../../output/playwright/website-local-only-settings.png'),
    });
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#hero-title').click({ position: { x: 25, y: 20 } });
    const feedback = page
      .locator('[data-ainotation-ui="markers"]')
      .getByRole('textbox', { name: 'Feedback content', exact: true });
    await feedback.fill('Local website demo feedback');
    await page
      .locator('[data-ainotation-ui="markers"]')
      .getByRole('button', { name: 'Add', exact: true })
      .click();
    await feedback.waitFor({ state: 'detached' });
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.locator('html').getAttribute('data-copied'))
      .toContain('Local website demo feedback');
    const downloading = page.waitForEvent('download');
    await shell.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const download = await downloading;
    const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
    expect(JSON.stringify(exported)).toContain('Local website demo feedback');
    await page.locator('#exit-demo').click();
    expect(await shell.count()).toBe(0);
    expect(await page.locator('[data-ainotation-ui="markers"]').count()).toBe(0);
    await page.reload({ waitUntil: 'networkidle' });
    await page.locator('#try-demo').click();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page
      .locator('[data-ainotation-ui="markers"]')
      .getByRole('button', { name: 'Edit annotation 1', exact: true })
      .click();
    expect(await feedback.inputValue()).toBe('Local website demo feedback');
    await page.locator('#exit-demo').click();
    expect(mcpRequests).toEqual([]);
    expect(
      await page.evaluate(
        () => JSON.parse(sessionStorage.getItem('ainotation:mcp:ainotation-website-demo')!).token,
      ),
    ).toBe('previous-demo-test-token');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await page.locator('#language-toggle').click();
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-mobile.png'),
      fullPage: true,
    });
    await page.locator('#tab-handoff').click();
    expect(await page.locator('.handoff-card').isVisible()).toBe(true);
    const card = (await page.locator('.handoff-card').boundingBox())!;
    expect(card.x).toBeGreaterThanOrEqual(0);
    expect(card.x + card.width).toBeLessThanOrEqual(390);
    await page.locator('#language-toggle').click();
    await page.setViewportSize({ width: 320, height: 740 });
    expect(
      await page.locator('html').evaluate((element) => element.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.locator('#tab-draw').click();
    const arrow = await page.locator('.draw-arrow').getAttribute('d');
    expect(arrow).toMatch(/^M/);
    expect(arrow).not.toContain('NaN');
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: resolve(root, '../../output/playwright/website-narrow.png'),
      fullPage: true,
      animations: 'disabled',
    });
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await new Promise<void>((resolve, reject) => {
      web.httpServer.close((error) => (error ? reject(error) : resolve()));
      if ('closeAllConnections' in web.httpServer) web.httpServer.closeAllConnections();
    });
  }
});
