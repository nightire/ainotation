import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { expect, it } from 'vite-plus/test';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { createPlaygroundServer, configurePage } from './helpers';

it('switches all five languages, retains drafts and errors, and restores the project preference', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ locale: 'zh-TW', viewport: { width: 1280, height: 900 } });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const mount = async () => {
      await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
      await expect
        .poll(() => shell.evaluate((element) => (element as InspectorShell).view.storage))
        .toBe('ready');
    };
    await mount();
    expect(await shell.getAttribute('lang')).toBe('zh-Hant');
    await shell.locator('.launcher').click();
    await page.locator('#sample-heading').click({ position: { x: 20, y: 10 } });
    const input = markers.locator('textarea');
    const draft = '用户原文 · 日本語のコメント · 사용자 피드백';
    await input.fill(draft);
    const inputNode = await input.elementHandle();
    const targets = await shell.evaluate((element) => (element as InspectorShell).view.selected);
    // A typed error remains translatable after it has already been displayed.
    await markers.locator('input[type=file]').setInputFiles({
      name: 'unsupported.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect.poll(() => markers.locator('.message').textContent()).toContain('PNG');
    await shell.locator('[data-command=settings]').click();
    const language = shell.locator('#inspector-language');
    expect(await language.locator('option').allTextContents()).toEqual([
      '简体中文',
      '繁體中文',
      'English',
      '日本語',
      '한국어',
    ]);
    const hostLanguage = await page.locator('html').getAttribute('lang');
    for (const [locale, settings, feedback, error] of [
      ['zh-Hans', '设置', '反馈内容', '请选择 PNG、JPEG 或 WebP 图片。'],
      ['zh-Hant', '設定', '回饋內容', '請選擇 PNG、JPEG 或 WebP 圖片。'],
      ['en', 'Settings', 'Feedback content', 'Choose a PNG, JPEG or WebP image.'],
      ['ja', '設定', 'フィードバックの内容', 'PNG、JPEG、WebP の画像を選択してください。'],
      ['ko', '설정', '피드백 내용', 'PNG, JPEG 또는 WebP 이미지를 선택하세요.'],
    ] as const) {
      await language.selectOption(locale);
      await expect.poll(() => shell.getAttribute('lang')).toBe(locale);
      expect(await markers.getAttribute('lang')).toBe(locale);
      expect(await shell.locator('.settings-heading h2').textContent()).toBe(settings);
      expect(await input.getAttribute('aria-label')).toBe(feedback);
      expect(await input.inputValue()).toBe(draft);
      expect(await markers.locator('.message').textContent()).toBe(error);
      expect(await inputNode!.evaluate((element) => element.isConnected)).toBe(true);
      expect(await shell.evaluate((element) => (element as InspectorShell).view.selected)).toEqual(
        targets,
      );
      expect(await page.locator('html').getAttribute('lang')).toBe(hostLanguage);
      await page.screenshot({
        path: resolve(import.meta.dirname, `../../../output/playwright/i18n-${locale}.png`),
      });
    }
    await language.selectOption('ja');
    await input.press('Meta+Enter');
    await expect
      .poll(() =>
        shell.evaluate((element) => (element as InspectorShell).view.document?.annotations.length),
      )
      .toBe(1);
    const saved = await shell.evaluate((element) => (element as InspectorShell).view.document!);
    expect(saved.annotations[0]!.comment).toBe(draft);
    await page.keyboard.down('Alt');
    await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
    await page.keyboard.up('Alt');
    await mount();
    expect(await shell.getAttribute('lang')).toBe('ja');
    await page.reload();
    await mount();
    expect(await shell.getAttribute('lang')).toBe('ja');
    await shell.locator('.launcher').click();
    await markers.locator('[data-annotation-id]').click();
    expect(await input.inputValue()).toBe(draft);
    expect(await shell.evaluate((element) => (element as InspectorShell).view.document)).toEqual(
      saved,
    );

    const data = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, 640, 360);
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'localization.png',
      mimeType: 'image/png',
      buffer: Buffer.from(data, 'base64'),
    });
    const drawing = page.locator('[data-ainotation-ui="drawing"]');
    await drawing.locator('.drawing-surface').waitFor();
    expect(await drawing.getAttribute('lang')).toBe('ja');
    const bounds = (await drawing.locator('.drawing-surface').boundingBox())!;
    await page.mouse.move(bounds.x + 70, bounds.y + 70);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 280, bounds.y + 200);
    await page.mouse.up();
    const paths = await drawing.locator('[data-shape] > path').getAttribute('d');
    // Switch through the same runtime action used by Settings while its toolbar is hidden.
    await shell.evaluate((element) =>
      element.dispatchEvent(
        new CustomEvent('ainotation-action', { detail: { type: 'set-locale', value: 'ko' } }),
      ),
    );
    await expect.poll(() => drawing.getAttribute('lang')).toBe('ko');
    expect(await drawing.locator('[data-shape] > path').getAttribute('d')).toBe(paths);
    await drawing.getByRole('button', { name: '화살표', exact: true }).hover();
    expect(await drawing.getByRole('tooltip').textContent()).toBe('화살표 (A)');
    await page.keyboard.press('Meta+z');
    expect(await drawing.locator('[data-shape]').count()).toBe(0);
    await page.keyboard.press('Meta+Shift+z');
    expect(await drawing.locator('[data-shape] > path').getAttribute('d')).toBe(paths);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/i18n-drawing-ko.png'),
    });
    await drawing.getByRole('button', { name: '이미지 첨부', exact: true }).click();
    await markers.getByRole('img', { name: '첨부 이미지 1' }).waitFor();
    expect(await input.inputValue()).toBe(draft);
    expect(await shell.evaluate((element) => (element as InspectorShell).view.document)).toEqual(
      saved,
    );
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await web.close();
  }
}, 60000);
