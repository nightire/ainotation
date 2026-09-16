import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium, type Page } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';
import type { FeedbackExport } from '../../../packages/schema/src';

async function fixture(page: Page) {
  await page.evaluate(() => {
    const section = document.createElement('section');
    section.id = 'context-fixture';
    section.style.cssText =
      'position:fixed;left:30px;top:130px;width:680px;background:white;z-index:10;font:20px/2 sans-serif';
    section.innerHTML =
      '<h2>Earlier heading</h2><p id="quote">Before <span id="quote-target" class="quote-label">the wrong <em>label</em></span> after.</p><p>Following context</p><input type="password" value="PRIVATE_VALUE"><div id="shadow-context"></div>';
    const root = section.querySelector('#shadow-context')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p id="shadow-quote">Shadow text selection works</p>';
    section.dataset.clicks = '0';
    section.addEventListener(
      'click',
      () => (section.dataset.clicks = String(Number(section.dataset.clicks) + 1)),
    );
    document.body.append(section);
  });
}

async function dragQuote(page: Page, backwards = false, cancel = false) {
  const points = await page.evaluate(() => {
    const element = document.querySelector('#quote-target')!;
    const first = element.firstChild!;
    const last = element.querySelector('em')!.firstChild!;
    const start = document.createRange();
    start.setStart(first, 0);
    start.setEnd(first, 1);
    const end = document.createRange();
    end.setStart(last, 4);
    end.setEnd(last, 5);
    const a = start.getBoundingClientRect();
    const b = end.getBoundingClientRect();
    return [
      { x: a.left + 0.2, y: a.top + a.height / 2 },
      { x: b.right - 0.2, y: b.top + b.height / 2 },
    ];
  });
  if (backwards) points.reverse();
  await page.mouse.move(points[0]!.x, points[0]!.y);
  await page.mouse.down();
  await page.mouse.move(points[1]!.x, points[1]!.y, { steps: 12 });
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
}

it('captures text ranges and full context, switches copied detail and restores settings without losing JSON data', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('Missing server');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await fixture(page);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog');
    const getDocument = () => shell.evaluate((el) => (el as InspectorShell).view.document!);
    const exportJson = async () => {
      const downloading = page.waitForEvent('download');
      await shell.getByRole('button', { name: 'Export JSON', exact: true }).click();
      const stream = await (await downloading).createReadStream();
      let text = '';
      for await (const chunk of stream) text += String(chunk);
      return JSON.parse(text) as FeedbackExport;
    };
    await dragQuote(page, false, true);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.editorOpen)).toBe(false);
    await dragQuote(page);
    await editor.waitFor();
    expect((await markers.locator('.text-quote').textContent())?.trim()).toBe('the wrong label');
    expect(await page.locator('#context-fixture').getAttribute('data-clicks')).toBe('0');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dragQuote(page, true);
    await editor.waitFor();
    expect((await markers.locator('.text-quote').textContent())?.trim()).toBe('the wrong label');
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Fix this quoted label');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(async () => (await getDocument()).annotations.length).toBe(1);
    await editor.waitFor({ state: 'detached' });
    const original = await getDocument();
    const target = original.annotations[0]!.targets[0]!;
    expect(target.textSelection).toMatchObject({
      exact: 'the wrong label',
      prefix: 'Before ',
      suffix: ' after.',
      truncated: false,
    });
    expect(target.textSelection!.rects.length).toBeGreaterThan(0);
    expect(target.ancestors!.map((node) => node.tagName)).toContain('section');
    expect(target.styles).toHaveProperty('font-family');
    expect(target.styles).toHaveProperty('border-radius');
    expect(original.annotations[0]!.page.userAgent).toContain('Chrome');
    expect(JSON.stringify(original)).not.toContain('PRIVATE_VALUE');
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    const levels = shell.getByRole('button', { name: /^Output Detail:/ });
    expect(await levels.getAttribute('data-level')).toBe('standard');
    await levels.focus();
    await page.keyboard.press('Enter');
    expect(await levels.getAttribute('data-level')).toBe('detailed');
    await page.keyboard.press('Space');
    expect(await levels.getAttribute('data-level')).toBe('forensic');
    const setLevel = async (detail: string) => {
      for (let i = 0; i < 4; i++) {
        if ((await levels.getAttribute('data-level')) === detail) return;
        await levels.click();
      }
      expect(await levels.getAttribute('data-level')).toBe(detail);
    };
    const outputs: Record<string, string> = {};
    for (const detail of ['compact', 'standard', 'detailed', 'forensic']) {
      await setLevel(detail);
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.outputDetail))
        .toBe(detail);
      const previousCopy = await page.evaluate(() => navigator.clipboard.readText());
      await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .not.toBe(previousCopy);
      outputs[detail] = await page.evaluate(() => navigator.clipboard.readText());
      expect(outputs[detail]).toContain('the wrong label');
      expect(await getDocument()).toEqual(original);
    }
    expect(outputs.compact).not.toContain('Viewport:');
    expect(outputs.standard).not.toContain('Bounds (viewport px):');
    expect(outputs.detailed).toContain('Bounds (viewport px):');
    expect(outputs.detailed).not.toContain('Styles at annotation:');
    expect(outputs.forensic).toContain('Styles at annotation:');
    expect(outputs.forensic).toContain('DOM path:');
    expect(outputs.forensic).toContain('User Agent:');
    await setLevel('compact');
    expect((await exportJson()).annotations[0]!.targets).toEqual(original.annotations[0]!.targets);
    await setLevel('forensic');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          return new Promise((resolve) => {
            const request = indexedDB.open('ainotation-settings', 1);
            request.onsuccess = () => {
              const db = request.result;
              const value = db
                .transaction('preferences')
                .objectStore('preferences')
                .get(location.origin);
              value.onsuccess = () => {
                resolve(value.result);
                db.close();
              };
            };
          });
        }),
      )
      .toBe('forensic');
    await page.keyboard.press('Escape');
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    expect((await markers.locator('.text-quote').textContent())?.trim()).toBe('the wrong label');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    const shadowPoints = await page.locator('#shadow-quote').evaluate((element) => {
      const node = element.firstChild!;
      const a = document.createRange();
      a.setStart(node, 0);
      a.setEnd(node, 1);
      const b = document.createRange();
      b.setStart(node, 10);
      b.setEnd(node, 11);
      const start = a.getBoundingClientRect();
      const end = b.getBoundingClientRect();
      return [
        { x: start.left + 0.2, y: start.top + start.height / 2 },
        { x: end.right - 0.2, y: end.top + end.height / 2 },
      ];
    });
    await page.mouse.move(shadowPoints[0]!.x, shadowPoints[0]!.y);
    await page.mouse.down();
    await page.mouse.move(shadowPoints[1]!.x, shadowPoints[1]!.y, { steps: 10 });
    await page.mouse.up();
    await editor.waitFor();
    expect((await markers.locator('.text-quote').textContent())?.trim()).toBe('Shadow text');
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.selected[0]!.shadowHosts),
    ).toEqual(['#shadow-context']);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect((await getDocument()).annotations).toHaveLength(1);
    await page.reload();
    await fixture(page);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.outputDetail))
      .toBe('forensic');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    expect((await getDocument()).annotations[0]!.targets[0]!.textSelection).toEqual(
      target.textSelection,
    );
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
});
