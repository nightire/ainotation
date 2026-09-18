import { chromium } from 'playwright';
import { expect, it } from 'vite-plus/test';
import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { createPlaygroundServer, configurePage } from './helpers';

it('edits padding and margin in independent all-side, axis and individual modes without changing values on mode switches', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: 1440, height: 1000 },
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    const target = page.locator('#sample-output');
    await target.evaluate((el) => {
      (el as HTMLElement).style.padding = '4px 8px 12px 16px';
      (el as HTMLElement).style.margin = '1px 2px 3px 4px';
    });
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await target.click({ position: { x: 20, y: 10 } });
    const editor = page.locator('[data-ainotation-ui="markers"]').getByRole('dialog');
    await editor.getByRole('tab', { name: 'Styles', exact: true }).click();
    const values = (family: string) =>
      target.evaluate(
        (el, family) =>
          ['top', 'right', 'bottom', 'left'].map((side) =>
            (el as HTMLElement).style.getPropertyValue(`${family}-${side}`),
          ),
        family,
      );
    const field = (name: string) => editor.getByRole('textbox', { name, exact: true });
    const button = (name: string) => editor.getByRole('button', { name, exact: true });
    const padding = field('Padding'),
      margin = field('Margin');
    expect(await padding.inputValue()).toBe('');
    expect(await padding.getAttribute('placeholder')).toBe('Mixed');
    expect(await field('Top padding').count()).toBe(0);
    expect(await field('Top margin').count()).toBe(0);
    await editor.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/spacing-all.png'),
    });
    await button('Padding: Horizontal / vertical').click();
    expect(await values('padding')).toEqual(['4px', '8px', '12px', '16px']);
    const horizontal = field('Padding: Horizontal'),
      vertical = field('Padding: Vertical');
    expect(await horizontal.getAttribute('placeholder')).toBe('Mixed');
    await horizontal.click();
    const scroll = editor.locator('.style-scroll'),
      beforeScroll = await scroll.evaluate((el) => el.scrollTop);
    await page.mouse.wheel(0, -80);
    await expect.poll(() => values('padding')).toEqual(['4px', '9px', '12px', '17px']);
    expect(await scroll.evaluate((el) => el.scrollTop)).toBe(beforeScroll);
    await button('Undo').click();
    await expect.poll(() => values('padding')).toEqual(['4px', '8px', '12px', '16px']);
    await horizontal.fill('20px');
    await vertical.fill('10px');
    await expect.poll(() => values('padding')).toEqual(['10px', '20px', '10px', '20px']);
    expect(await padding.getAttribute('placeholder')).toBe('Mixed');
    await button('Restore original value: Padding: Horizontal').click();
    await expect.poll(() => values('padding')).toEqual(['10px', '8px', '10px', '16px']);
    await button('Undo').click();
    await expect.poll(() => values('padding')).toEqual(['10px', '20px', '10px', '20px']);
    await padding.fill('12px');
    await expect.poll(() => values('padding')).toEqual(['12px', '12px', '12px', '12px']);
    expect(await horizontal.inputValue()).toBe('12px');
    expect(await vertical.inputValue()).toBe('12px');
    await button('Padding: Individual sides').click();
    expect(await values('padding')).toEqual(['12px', '12px', '12px', '12px']);
    await field('Left padding').fill('24px');
    await expect.poll(() => values('padding')).toEqual(['12px', '12px', '12px', '24px']);
    expect(await padding.inputValue()).toBe('');
    await button('Margin: Horizontal / vertical').click();
    expect(await button('Padding: Individual sides').getAttribute('aria-pressed')).toBe('true');
    await field('Margin: Horizontal').fill('-6px');
    await field('Margin: Vertical').fill('auto');
    await expect.poll(() => values('margin')).toEqual(['auto', '-6px', 'auto', '-6px']);
    await editor.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/spacing-expanded.png'),
    });
    await button('Margin: Horizontal / vertical').click();
    expect(await field('Margin: Horizontal').count()).toBe(0);
    expect(await margin.getAttribute('placeholder')).toBe('Mixed');
    expect(await values('margin')).toEqual(['auto', '-6px', 'auto', '-6px']);
    await padding.fill('auto');
    expect(await editor.locator('.style-invalid').textContent()).toBe(
      'Enter a valid literal CSS value.',
    );
    expect(await button('Add').isDisabled()).toBe(true);
    await button('Restore original value: Padding').click();
    await expect.poll(() => values('padding')).toEqual(['4px', '8px', '12px', '16px']);
    expect(await values('margin')).toEqual(['auto', '-6px', 'auto', '-6px']);
    await button('Undo').click();
    await expect.poll(() => values('padding')).toEqual(['12px', '12px', '12px', '24px']);
    await button('Padding: Individual sides').click();
    expect(await field('Top padding').count()).toBe(0);
    await button('Cancel').click();
    await editor.waitFor({ state: 'detached' });
    expect(await values('padding')).toEqual(['4px', '8px', '12px', '16px']);
    expect(await values('margin')).toEqual(['1px', '2px', '3px', '4px']);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});

it('edits styles in the real marker panel, isolates native wheel, and preserves text/images across save and reload', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: 1280, height: 1000 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    const target = page.locator('#sample-output');
    await target.evaluate(
      (el) =>
        ((el as HTMLElement).style.cssText = 'padding:8px;border:1px solid red;border-radius:4px'),
    );
    const original = await target.getAttribute('style');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await target.click({ position: { x: 20, y: 10 } });
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog');
    const feedback = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    await feedback.fill('More breathing room');
    await editor.getByRole('tab', { name: 'Styles', exact: true }).click();
    const previewToggle = editor.getByRole('checkbox', { name: 'Preview changes', exact: true });
    expect(await previewToggle.isChecked()).toBe(true);
    await editor.getByRole('button', { name: 'Padding: Individual sides', exact: true }).click();
    const padding = editor.getByRole('textbox', { name: 'Top padding', exact: true });
    await padding.fill('16px');
    await expect.poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('16px');
    const scroll = editor.locator('.style-scroll');
    await padding.click();
    const before = {
      inner: await scroll.evaluate((el) => el.scrollTop),
      outer: await editor.evaluate((el) => el.scrollTop),
      page: await page.evaluate(() => scrollY),
    };
    await page.mouse.wheel(0, -80);
    await expect.poll(() => padding.inputValue()).toBe('17px');
    await page.keyboard.down('Shift');
    await page.mouse.wheel(-80, 0);
    await page.keyboard.up('Shift');
    await expect.poll(() => padding.inputValue()).toBe('27px');
    expect({
      inner: await scroll.evaluate((el) => el.scrollTop),
      outer: await editor.evaluate((el) => el.scrollTop),
      page: await page.evaluate(() => scrollY),
    }).toEqual(before);
    expect(await scroll.evaluate((el) => getComputedStyle(el).borderBottomWidth)).toBe('1px');
    await editor
      .getByRole('button', { name: 'Restore original value: Top padding', exact: true })
      .click();
    await expect.poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('8px');
    await padding.fill('20px');
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    expect(await previewToggle.isChecked()).toBe(true);
    await editor.getByRole('button', { name: 'Return to previous element', exact: true }).click();
    expect(await previewToggle.isChecked()).toBe(true);
    await expect.poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('20px');
    await editor.getByRole('checkbox', { name: 'Preview changes', exact: true }).uncheck();
    await expect.poll(() => target.getAttribute('style')).toBe(original);
    await editor.getByRole('button', { name: 'Select parent element', exact: true }).click();
    expect(await previewToggle.isChecked()).toBe(true);
    await editor.getByRole('button', { name: 'Return to previous element', exact: true }).click();
    expect(await previewToggle.isChecked()).toBe(false);
    expect(await target.getAttribute('style')).toBe(original);
    await editor.getByRole('checkbox', { name: 'Preview changes', exact: true }).check();
    await expect.poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('20px');
    await editor.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/style-editor-integrated.png'),
    });
    await editor.getByRole('tab', { name: 'Feedback', exact: true }).click();
    expect(await feedback.inputValue()).toBe('More breathing room');
    const png = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 48;
      c.height = 48;
      return c.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'reference.png',
      mimeType: 'image/png',
      buffer: Buffer.from(png, 'base64'),
    });
    const drawing = page.locator('[data-ainotation-ui="drawing"]');
    await drawing.getByRole('button', { name: 'Attach image', exact: true }).click();
    await drawing.waitFor({ state: 'detached' });
    await editor.getByRole('button', { name: 'Edit image 1', exact: true }).waitFor();
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect(await target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('20px');
    const saved = await shell.evaluate(
      (el) => (el as InspectorShell).view.document!.annotations[0]!,
    );
    expect(saved.images).toHaveLength(1);
    expect(saved.targets[0]!.styleChanges).toEqual([
      { property: 'padding-top', before: '8px', value: '20px' },
    ]);
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain('padding-top: "8px" → "20px"');
    await page.reload();
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    await editor.getByRole('tab', { name: /Styles/ }).click();
    expect(
      await editor.getByRole('checkbox', { name: 'Preview changes', exact: true }).isChecked(),
    ).toBe(true);
    await editor
      .getByRole('button', { name: 'Preview over current styles', exact: true })
      .waitFor();
    await editor.getByRole('button', { name: 'Preview over current styles', exact: true }).click();
    await expect.poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('20px');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect(await target.evaluate((el) => getComputedStyle(el).paddingTop)).toBe('20px');
    await shell.getByRole('switch', { name: 'Preview all changes', exact: true }).click();
    await expect
      .poll(() => target.evaluate((el) => getComputedStyle(el).paddingTop))
      .not.toBe('20px');
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});

it('shares styles between a multi-target marker and a single-target marker with page-wide preview', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({
      locale: 'en-US',
      viewport: { width: 1280, height: 1000 },
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.style.cssText =
        'position:fixed;left:40px;top:220px;padding:20px;background:white;z-index:10';
      fixture.innerHTML =
        '<button id="shared-a" style="font-size:14px;padding:10px">Menu item A</button><button id="shared-b" style="font-size:16px;padding:10px;margin-left:12px">Menu item B</button>';
      document.body.append(fixture);
    });
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell'),
      markers = page.locator('[data-ainotation-ui="markers"]'),
      editor = markers.getByRole('dialog');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.keyboard.down('Shift');
    await page.locator('#shared-a').click();
    await page.locator('#shared-b').click();
    await page.keyboard.up('Shift');
    await editor.getByRole('tab', { name: /Styles/ }).click();
    await editor.getByText('Typography', { exact: true }).click();
    const font = editor.getByRole('textbox', { name: 'Font size', exact: true });
    const sizes = () =>
      page
        .locator('#shared-a,#shared-b')
        .evaluateAll((elements) => elements.map((el) => getComputedStyle(el).fontSize));
    expect(await font.getAttribute('placeholder')).toBe('Mixed');
    expect(
      await editor.getByRole('combobox', { name: 'Editing target', exact: true }).inputValue(),
    ).toBe('');
    await font.fill('18px');
    await expect.poll(sizes).toEqual(['18px', '18px']);
    await editor
      .getByRole('button', { name: 'Restore original value: Font size', exact: true })
      .click();
    await expect.poll(sizes).toEqual(['14px', '16px']);
    await font.press('ArrowUp');
    await expect.poll(sizes).toEqual(['15px', '17px']);
    await font.hover();
    await page.mouse.wheel(0, -80);
    await expect.poll(sizes).toEqual(['16px', '18px']);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(sizes).toEqual(['15px', '17px']);
    const save = async (text: string) => {
      await editor.getByRole('tab', { name: 'Feedback', exact: true }).click();
      await editor.getByRole('textbox', { name: 'Feedback content', exact: true }).fill(text);
      await editor.locator('.actions .primary').click();
      await editor.waitFor({ state: 'detached' });
    };
    await save('Menu group');
    expect(await sizes()).toEqual(['15px', '17px']);
    await page.locator('#shared-a').click();
    await save('One menu item');
    await markers.getByRole('button', { name: 'Edit annotation 2', exact: true }).click();
    await editor.getByRole('tab', { name: /Styles/ }).click();
    await editor.getByRole('textbox', { name: 'Font size', exact: true }).fill('22px');
    await expect.poll(sizes).toEqual(['22px', '17px']);
    await page.mouse.click(1200, 150);
    await editor.waitFor({ state: 'detached' });
    expect(await sizes()).toEqual(['22px', '17px']);
    const global = shell.getByRole('switch', { name: 'Preview all changes', exact: true });
    await global.click();
    await expect.poll(sizes).toEqual(['14px', '16px']);
    await global.click();
    await expect.poll(sizes).toEqual(['22px', '17px']);
    await markers.getByRole('button', { name: 'Edit annotation 2', exact: true }).click();
    await editor.getByRole('checkbox', { name: 'Preview changes', exact: true }).uncheck();
    await expect.poll(sizes).toEqual(['14px', '17px']);
    await page.mouse.click(1200, 150);
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    await editor.getByRole('tab', { name: /Styles/ }).click();
    const local = editor.getByRole('checkbox', { name: 'Preview these 2 elements', exact: true });
    expect(await local.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
    await local.check();
    await expect.poll(sizes).toEqual(['22px', '17px']);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expect.poll(sizes).toEqual(['15px', '17px']);
    await markers.getByRole('button', { name: 'Edit annotation 2', exact: true }).click();
    await editor.getByRole('tab', { name: /Styles/ }).click();
    await editor.getByRole('textbox', { name: 'Font size', exact: true }).fill('22px');
    await save('Shared update');
    await markers.getByRole('button', { name: 'Edit annotation 2', exact: true }).click();
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect(await sizes()).toEqual(['22px', '17px']);
    const download = page.waitForEvent('download');
    await shell.getByRole('button', { name: 'Export JSON', exact: true }).click();
    const result = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
    expect(Object.keys(result.targetStyles)).toHaveLength(2);
    expect(result.annotations).toHaveLength(1);
    expect(
      result.annotations[0].targets.map(
        (target: { styleChanges: { value: string }[] }) => target.styleChanges[0]!.value,
      ),
    ).toEqual(['22px', '17px']);
    await global.click();
    await expect.poll(sizes).toEqual(['14px', '16px']);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
