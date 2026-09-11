import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('keeps markers and drafts separate across fresh route DOM while copying all project pages', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    const origin = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(origin);
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog');
    const document = () => shell.evaluate((el) => (el as InspectorShell).view.document!);
    const ready = async (path: string) => {
      await expect.poll(async () => (await document())?.url).toBe(origin + path);
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
        .toBe('ready');
    };
    const navigate = async (name: 'Samples' | 'Checkout') => {
      await page.keyboard.down('Alt');
      await page.getByRole('link', { name, exact: true }).click();
      await page.keyboard.up('Alt');
      await ready(name === 'Samples' ? '/' : '/checkout');
    };
    const save = async (selector: string, text: string) => {
      await page.locator(selector).click({ position: { x: 20, y: 10 } });
      const input = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
      await input.fill(text);
      await input.press('Meta+Enter');
      await editor.waitFor({ state: 'detached' });
      await expect
        .poll(async () => (await document()).annotations.some((note) => note.comment === text))
        .toBe(true);
    };
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await ready('/');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await shell.evaluate((el) => el.setAttribute('data-route-instance', 'original'));
    await save('#sample-heading', 'Route A feedback');
    const first = (await document()).annotations[0]!;
    await navigate('Checkout');
    expect((await document()).annotations).toEqual([]);
    expect(await markers.locator('[data-annotation-id]').count()).toBe(0);
    await save('#checkout-heading', 'Route B feedback');
    const second = (await document()).annotations[0]!;
    await navigate('Samples');
    expect(await shell.getAttribute('data-route-instance')).toBe('original');
    await markers.locator(`[data-annotation-id="${first.id}"]`).waitFor();
    expect(
      await shell.evaluate((el) => Object.values((el as InspectorShell).view.availability)),
    ).toEqual(['available']);
    expect((await document()).annotations.map((note) => note.id)).toEqual([first.id]);
    await page.locator('#sample-output').click({ position: { x: 20, y: 10 } });
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Unsubmitted on A');
    await navigate('Checkout');
    expect((await document()).annotations.map((note) => note.id)).toEqual([second.id]);
    expect(await editor.count()).toBe(0);
    await page.goBack();
    await ready('/');
    expect(
      await editor.getByRole('textbox', { name: 'Feedback content', exact: true }).inputValue(),
    ).toBe('Unsubmitted on A');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('Route B feedback');
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`Page: ${origin}/`);
    expect(copied).toContain(`Page: ${origin}/checkout`);
    expect(copied.split('Route A feedback')).toHaveLength(2);
    expect(copied.split('Route B feedback')).toHaveLength(2);
    expect(copied).not.toContain('Unsubmitted on A');
    await shell.getByRole('button', { name: 'Clear all annotations', exact: true }).click();
    await expect.poll(async () => (await document()).annotations.length).toBe(0);
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .not.toContain('Route A feedback');
    const afterClear = await page.evaluate(() => navigator.clipboard.readText());
    expect(afterClear).not.toContain('Route A feedback');
    expect(afterClear).toContain('Route B feedback');
    await page.goForward();
    await ready('/checkout');
    expect((await document()).annotations.map((note) => note.id)).toEqual([second.id]);
    await page.reload();
    await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await ready('/checkout');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.locator(`[data-annotation-id="${second.id}"]`).waitFor();
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
