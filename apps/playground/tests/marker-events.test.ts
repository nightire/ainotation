import { createPlaygroundServer, configurePage } from './helpers';
import { resolve } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { chromium, type Locator } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

it.each(['mouse', 'touch', 'keyboard'] as const)(
  'edits a submenu annotation with %s without dismissing the host menu or picking underneath',
  async (input) => {
    const web = await createPlaygroundServer(import.meta.url);
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      await web.listen();
      const address = web.httpServer?.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const page = await browser.newPage({
        viewport: { width: 1280, height: 1000 },
        hasTouch: input === 'touch',
      });
      const errors: string[] = [];
      configurePage(page, errors);
      await page.goto(`http://127.0.0.1:${address.port}`);
      // Register before mounting the SDK, as host outside-interaction handlers do.
      await page.evaluate(() => {
        const events: string[] = [];
        (window as unknown as { markerHostEvents: string[] }).markerHostEvents = events;
        for (const type of [
          'pointerdown',
          'mousedown',
          'mouseup',
          'click',
          'touchstart',
          'touchend',
          'focusin',
          'focusout',
          'keydown',
          'beforeinput',
          'input',
        ])
          document.addEventListener(
            type,
            (event) => {
              const own = (target: EventTarget | null) =>
                target instanceof HTMLElement && target.dataset.ainotationUi === 'markers';
              if (event instanceof KeyboardEvent && (event.altKey || event.key === 'Alt')) return;
              if (
                event.composedPath().some(own) ||
                (event instanceof FocusEvent && own(event.relatedTarget))
              )
                events.push(type);
            },
            { capture: true },
          );
      });
      const touch = input === 'touch' ? await page.context().newCDPSession(page) : undefined;
      const click = async (target: Locator, alt = false) => {
        if (!touch) return target.click();
        await target.scrollIntoViewIfNeeded();
        const box = (await target.boundingBox())!;
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          modifiers: alt ? 1 : 0,
          touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
        });
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          modifiers: alt ? 1 : 0,
          touchPoints: [],
        });
      };
      const shell = page.locator('ainotation-inspector-shell');
      const markers = page.locator('[data-ainotation-ui="markers"]');
      const menu = page.getByRole('menu', { name: 'Document actions', exact: true });
      const submenu = page.getByRole('menu', { name: 'Export formats', exact: true });
      const editor = markers.getByRole('dialog');
      const text = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
      await click(page.getByRole('button', { name: 'Mount inspector', exact: true }));
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
        .toBe('ready');
      await click(shell.getByRole('button', { name: 'Open inspector', exact: true }));
      await page.keyboard.down('Alt');
      await click(page.getByRole('button', { name: 'Open menu', exact: true }), true);
      await click(menu.getByRole('menuitem', { name: 'Export as', exact: true }), true);
      await page.keyboard.up('Alt');
      await click(submenu.getByRole('menuitem', { name: 'PDF', exact: true }));
      await text.waitFor();
      expect(await submenu.isVisible()).toBe(true);
      await text.fill('Keep the export menu open');
      await click(editor.getByRole('button', { name: 'Add', exact: true }));
      await expect
        .poll(() =>
          shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length),
        )
        .toBe(1);
      expect(await submenu.isVisible()).toBe(true);
      const saved = await shell.evaluate(
        (el) => (el as InspectorShell).view.document!.annotations[0]!,
      );
      const marker = markers.getByRole('button', { name: 'Edit annotation 1', exact: true });
      if (input === 'keyboard') {
        await marker.focus();
        await marker.press('Enter');
      } else await click(marker);
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.editingId))
        .toBe(saved.id);
      expect(await text.inputValue()).toBe(saved.comment);
      expect(await submenu.isVisible()).toBe(true);
      expect(await shell.evaluate((el) => (el as InspectorShell).view.selected)).toEqual(
        saved.targets,
      );
      await click(text);
      await text.press('ControlOrMeta+A');
      await page.keyboard.type('Revised export menu note');
      expect(await text.inputValue()).toBe('Revised export menu note');
      expect(await submenu.isVisible()).toBe(true);
      await page.screenshot({
        path: resolve(import.meta.dirname, `../../../output/playwright/marker-menu-${input}.png`),
      });
      const choosing = page.waitForEvent('filechooser');
      await click(editor.getByRole('button', { name: 'Choose image', exact: true }));
      const chooser = await choosing;
      const png = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
        return canvas.toDataURL('image/png').split(',')[1]!;
      });
      await chooser.setFiles({
        name: 'marker.png',
        mimeType: 'image/png',
        buffer: Buffer.from(png, 'base64'),
      });
      const drawing = page.locator('[data-ainotation-ui="drawing"]');
      await drawing.getByRole('button', { name: 'Cancel drawing', exact: true }).waitFor();
      await click(drawing.getByRole('button', { name: 'Cancel drawing', exact: true }));
      await drawing.waitFor({ state: 'detached' });
      expect(await text.inputValue()).toBe('Revised export menu note');
      await click(editor.getByRole('button', { name: 'Save', exact: true }));
      await expect
        .poll(() =>
          shell.evaluate((el) => (el as InspectorShell).view.document!.annotations[0]!.comment),
        )
        .toBe('Revised export menu note');
      expect(
        await shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length),
      ).toBe(1);
      expect(await submenu.isVisible()).toBe(true);
      if (input === 'keyboard') {
        await marker.focus();
        await marker.press('Space');
      } else await click(marker);
      await text.press('Escape');
      await editor.waitFor({ state: 'detached' });
      expect(await submenu.isVisible()).toBe(true);
      expect(
        await page.evaluate(
          () => (window as unknown as { markerHostEvents: string[] }).markerHostEvents,
        ),
      ).toEqual([]);
      await page.keyboard.down('Alt');
      await click(submenu.getByRole('menuitem', { name: 'Plain text', exact: true }), true);
      await page.keyboard.up('Alt');
      expect(await menu.isVisible()).toBe(false);
      expect(await page.locator('#sample-menu-result').textContent()).toBe(
        'Selected: Export plain text',
      );
      expect(errors).toEqual([]);
    } finally {
      await Promise.all([browser?.close(), web.close()]);
    }
  },
);
