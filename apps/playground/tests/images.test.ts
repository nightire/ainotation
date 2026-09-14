import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'vite-plus';
import { expect, it } from 'vite-plus/test';
import { chromium, type Locator, type Page } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startSharedService } from '@ainotation/mcp/service';
import { createProjectMcpServer } from '@ainotation/mcp/bridge';
import { ainotation } from '@ainotation/vite';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { configurePage } from './helpers';

async function withEditor(
  run: (page: Page, client: Client) => Promise<void>,
  deviceScaleFactor = 1,
) {
  const temporary = await mkdtemp(join(tmpdir(), 'ainotation-images-'));
  const shared = await startSharedService({ directory: join(temporary, 'service') });
  const root = resolve(import.meta.dirname, '..');
  const web = await createServer({
    configFile: false,
    root,
    logLevel: 'silent',
    cacheDir: join(temporary, 'vite'),
    plugins: [ainotation({ name: 'image-test', serviceDirectory: shared.directory })],
    server: { host: '127.0.0.1', port: 0 },
  });
  const bridge = createProjectMcpServer({ cwd: root, serviceDirectory: shared.directory });
  const client = new Client({ name: 'images-test', version: '1' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    await web.listen();
    const address = web.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test address');
    browser = await chromium.launch({
      channel: 'chrome',
      headless: true,
      args: [
        '--auto-accept-this-tab-capture',
        '--auto-select-tab-capture-source-by-title=Ainotation Image Test',
        '--enable-usermedia-screen-capturing',
      ],
    });
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      deviceScaleFactor,
    });
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.evaluate(() => {
      document.title = 'Ainotation Image Test';
    });
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection), {
        timeout: 15000,
      })
      .toBe('connected');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.locator('h1').click({ position: { x: 30, y: 10 } });
    await run(page, client);
    expect(errors).toEqual([]);
  } finally {
    await browser?.close();
    await client.close();
    await bridge.close();
    await web.close();
    await shared.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function draw(page: Page) {
  const editor = page.locator('[data-ainotation-ui="drawing"]');
  const surface = editor.locator('.drawing-surface');
  await surface.waitFor();
  const rect = await surface.boundingBox();
  if (!rect) throw new Error('Missing drawing surface');
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.7, rect.y + rect.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => surface.locator('[data-shape]').count()).toBe(1);
}

it('crops imported images after moving and resizing the crop without capturing its guides', async () => {
  await withEditor(async (page) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, 800, 500);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(100, 100, 300, 200);
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'crop.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
    const editor = page.locator('[data-ainotation-ui="drawing"]'),
      surface = editor.locator('.drawing-surface');
    await surface.waitFor();
    await page.setViewportSize({ width: 600, height: 700 });
    const point = (x: number, y: number) =>
      surface.evaluate(
        (element, coords) => {
          const p = new DOMPoint(coords.x, coords.y).matrixTransform(
            (element as SVGSVGElement).getScreenCTM()!,
          );
          return { x: p.x, y: p.y };
        },
        { x, y },
      );
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      const start = await point(x1, y1),
        end = await point(x2, y2);
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    };
    await drag(150, 170, 320, 240);
    await page.keyboard.press('x');
    await drag(350, 250, 50, 50); // Reverse crop, then move it onto the green region.
    const area = editor.locator('[data-crop-area]');
    expect(Number(await area.getAttribute('width'))).toBeCloseTo(300);
    await drag(200, 150, 250, 200);
    expect(Number(await area.getAttribute('x'))).toBeCloseTo(100);
    expect(Number(await area.getAttribute('y'))).toBeCloseTo(100);
    await drag(400, 300, 420, 320);
    expect(Number(await area.getAttribute('width'))).toBeCloseTo(320);
    await page.keyboard.press('Meta+z');
    expect(Number(await area.getAttribute('width'))).toBeCloseTo(300);
    await page.keyboard.press('Meta+Shift+z');
    expect(Number(await area.getAttribute('width'))).toBeCloseTo(320);
    await page.keyboard.press('Meta+z');
    await page.keyboard.press('d');
    expect(await area.count()).toBe(0);
    await page.keyboard.press('Meta+z');
    expect(await area.count()).toBe(1);
    await page.keyboard.press('a');
    expect(await area.count()).toBe(1);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-crop.png'),
    });
    await editor.getByRole('button', { name: 'Attach image', exact: true }).click();
    const preview = markers.getByRole('img', { name: 'Attached image 1' });
    await preview.waitFor();
    const result = await preview.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i]! > 180 && pixels[i + 1]! < 130) red++;
      return {
        width: canvas.width,
        height: canvas.height,
        corner: [...ctx.getImageData(5, 5, 1, 1).data],
        red,
      };
    });
    expect(result.width).toBe(300);
    expect(result.height).toBe(200);
    expect(result.corner).toEqual([34, 197, 94, 255]);
    expect(result.red).toBeGreaterThan(100);
  });
}, 60000);

it('crops a real high-DPI tab using capture pixels and preserves host UI plus annotations', async () => {
  await withEditor(async (page) => {
    await page.evaluate(() => {
      const native = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const stream = await native(options);
        (window as Window & { cropCapture?: MediaStream }).cropCapture = stream;
        return stream;
      };
      const panel = document.createElement('div');
      panel.style.cssText =
        'position:fixed;left:100px;top:150px;width:300px;height:200px;background:rgb(20,80,180);z-index:10000';
      document.body.append(panel);
    });
    const markers = page.locator('[data-ainotation-ui="markers"]');
    await markers.getByRole('button', { name: 'Screenshot', exact: true }).click();
    const editor = page.locator('[data-ainotation-ui="drawing"]');
    await editor.locator('.drawing-surface').waitFor({ timeout: 10000 });
    await page.mouse.move(150, 200);
    await page.mouse.down();
    await page.mouse.move(320, 280, { steps: 8 });
    await page.mouse.up();
    await editor.getByRole('button', { name: 'Crop', exact: true }).click();
    await page.mouse.move(100, 150);
    await page.mouse.down();
    await page.mouse.move(400, 350, { steps: 8 });
    await page.mouse.up();
    const settings = await page.evaluate(() =>
      (window as Window & { cropCapture?: MediaStream })
        .cropCapture!.getVideoTracks()[0]!
        .getSettings(),
    );
    expect(await page.evaluate(() => devicePixelRatio)).toBe(2);
    await editor.getByRole('button', { name: 'Capture and attach', exact: true }).click();
    const preview = markers.getByRole('img', { name: 'Attached image 1' });
    await expect
      .poll(
        async () =>
          (await preview.isVisible()) ? 'attached' : editor.getByRole('status').allTextContents(),
        { timeout: 10000 },
      )
      .toBe('attached');
    const result = await preview.evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let red = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i]! > 180 && pixels[i + 1]! < 130) red++;
      return {
        width: canvas.width,
        height: canvas.height,
        corner: [...ctx.getImageData(5, 5, 1, 1).data],
        red,
      };
    });
    expect(result.width).toBe((settings.width! * 300) / 1280);
    expect(result.height).toBe((settings.height! * 200) / 900);
    expect(
      result.corner.every((channel, index) => Math.abs(channel - [20, 80, 180, 255][index]!) < 4),
    ).toBe(true);
    expect(result.red).toBeGreaterThan(100);
  }, 2);
}, 60000);

it('marquee-selects multiple shapes for atomic moves, styling and deletion', async () => {
  await withEditor(async (page) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, 800, 500);
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'multiple.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
    const editor = page.locator('[data-ainotation-ui="drawing"]');
    const surface = editor.locator('.drawing-surface');
    await surface.waitFor();
    const point = (x: number, y: number) =>
      surface.evaluate(
        (element, position) => {
          const p = new DOMPoint(position.x, position.y).matrixTransform(
            (element as SVGSVGElement).getScreenCTM()!,
          );
          return { x: p.x, y: p.y };
        },
        { x, y },
      );
    const drag = async (x1: number, y1: number, x2: number, y2: number) => {
      const first = await point(x1, y1),
        last = await point(x2, y2);
      await page.mouse.move(first.x, first.y);
      await page.mouse.down();
      await page.mouse.move(last.x, last.y, { steps: 6 });
      await page.mouse.up();
    };
    for (const [key, x1, y1, x2, y2] of [
      ['r', 50, 60, 140, 130],
      ['e', 230, 60, 300, 140],
      ['a', 60, 220, 180, 260],
      ['f', 450, 200, 540, 260],
    ] as const) {
      await page.keyboard.press(key);
      await drag(x1, y1, x2, y2);
    }
    const shapes = editor.locator('[data-shape]');
    const selected = editor.locator('[data-shape][data-selected="true"]');
    const selectedIndices = () =>
      selected.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('data-shape')),
      );
    expect(await shapes.count()).toBe(4);
    await page.keyboard.press('v');
    await drag(25, 30, 330, 170);
    expect(await selectedIndices()).toEqual(['0', '1']);
    expect(
      await editor.locator('[data-group-selection]').getAttribute('data-group-selection'),
    ).toBe('2');
    expect(await editor.locator('[data-marquee]').count()).toBe(0);
    const before = await shapes.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y };
      }),
    );
    await drag(50, 90, 90, 120);
    const after = await shapes.evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { x: bounds.x, y: bounds.y };
      }),
    );
    for (const index of [0, 1]) {
      expect(after[index]!.x - before[index]!.x).toBeCloseTo(40);
      expect(after[index]!.y - before[index]!.y).toBeCloseTo(30);
    }
    expect(after.slice(2)).toEqual(before.slice(2));
    await page.keyboard.press('Meta+z');
    expect(await selectedIndices()).toEqual(['0', '1']);
    expect(
      await shapes.nth(0).evaluate((element) => element.getBoundingClientRect().x),
    ).toBeCloseTo(before[0]!.x);
    await page.keyboard.press('Meta+Shift+z');
    expect(
      await shapes.nth(0).evaluate((element) => element.getBoundingClientRect().x),
    ).toBeCloseTo(after[0]!.x);
    await page.keyboard.press('c');
    expect(
      await selected.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('stroke')),
      ),
    ).toEqual(['#f59e0b', '#f59e0b']);
    expect(await shapes.nth(2).getAttribute('stroke')).toBe('#ef4444');
    await page.keyboard.press('s');
    expect(
      await selected.evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('stroke-width')),
      ),
    ).toEqual(['4', '4']);
    await page.keyboard.press('d');
    expect(await shapes.count()).toBe(2);
    await page.keyboard.press('Meta+z');
    expect(await shapes.count()).toBe(4);
    expect(await selectedIndices()).toEqual(['0', '1']);
    await page.keyboard.press('Meta+Shift+z');
    expect(await shapes.count()).toBe(2);
    await page.keyboard.press('Meta+z');
    await editor.getByRole('button', { name: 'Delete shape', exact: true }).click();
    expect(await shapes.count()).toBe(2);
    await page.keyboard.press('Meta+z');
    // Reverse-direction marquee replaces selection; Shift+marquee adds to it.
    await drag(200, 280, 40, 200);
    expect(await selectedIndices()).toEqual(['2']);
    await page.keyboard.down('Shift');
    await drag(430, 180, 560, 280);
    await page.keyboard.up('Shift');
    expect(await selectedIndices()).toEqual(['2', '3']);
    const arrow = await point(120, 240);
    await page.keyboard.down('Shift');
    await page.mouse.click(arrow.x, arrow.y);
    await page.keyboard.up('Shift');
    expect(await selectedIndices()).toEqual(['3']);
    const blank = await point(700, 400);
    await page.mouse.click(blank.x, blank.y);
    expect(await selected.count()).toBe(0);
    // Frame selection uses the current SVG coordinate mapping at a smaller viewport.
    await page.setViewportSize({ width: 600, height: 700 });
    await drag(400, 300, 20, 20);
    expect(await selectedIndices()).toEqual(['0', '1', '2']);
    // Cancelling a partial marquee by entering Alt restores the prior selection.
    const start = await point(700, 350),
      end = await point(420, 180);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y);
    expect(await editor.locator('[data-marquee]').count()).toBe(1);
    await page.keyboard.down('Alt');
    await page.mouse.up();
    await page.keyboard.up('Alt');
    expect(await selectedIndices()).toEqual(['0', '1', '2']);
    expect(await editor.locator('[data-marquee]').count()).toBe(0);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-multiple.png'),
    });
    await editor.getByRole('button', { name: 'Attach image', exact: true }).click();
    await markers.getByRole('img', { name: 'Attached image 1' }).waitFor();
    const bluePixels = await markers.getByRole('img').evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let blue = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 2]! > pixels[i]! + 20) blue++;
      return blue;
    });
    expect(bluePixels).toBe(0);
  });
}, 60000);

it.each(['button', 'touch', 'shortcut'] as const)(
  'keeps menus in the final screenshot with %s confirmation and restores Alt dismissal',
  async (confirmation) => {
    await withEditor(async (page) => {
      const markers = page.locator('[data-ainotation-ui="markers"]');
      await page.evaluate(() => {
        const trigger = document.createElement('button');
        trigger.id = 'menu-drawing-trigger';
        trigger.textContent = 'Open drawing menu';
        trigger.style.cssText = 'position:fixed;left:40px;top:80px;z-index:10000';
        const menu = document.createElement('div');
        menu.id = 'menu-drawing-portal';
        menu.hidden = true;
        menu.style.cssText =
          'position:fixed;left:40px;top:140px;width:220px;height:160px;background:rgb(20,80,180);z-index:10000';
        menu.textContent = 'Menu to annotate';
        const native = document.createElement('div');
        native.id = 'native-drawing-menu';
        native.popover = 'auto';
        native.style.cssText =
          'position:fixed;inset:auto;left:800px;top:140px;width:200px;height:160px;margin:0;background:rgb(20,180,80)';
        native.textContent = 'Native popover';
        trigger.onclick = () => {
          menu.hidden = false;
          delete menu.dataset.closedBy;
          native.showPopover();
        };
        const outside = (event: Event) => {
          if (
            !menu.hidden &&
            event.target instanceof Node &&
            !menu.contains(event.target) &&
            event.target !== trigger
          ) {
            menu.hidden = true;
            menu.dataset.closedBy = event.type;
          }
        };
        for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
          document.addEventListener(type, outside, true);
          document.addEventListener(type, outside);
        }
        trigger.addEventListener('blur', () => {
          menu.hidden = true;
          menu.dataset.closedBy = 'blur';
        });
        document.body.append(trigger, menu, native);
      });
      await markers.getByRole('button', { name: 'Screenshot', exact: true }).click();
      const editor = page.locator('[data-ainotation-ui="drawing"]');
      await editor.locator('.drawing-surface').waitFor({ timeout: 10000 });
      await page.keyboard.down('Alt');
      await page.locator('#menu-drawing-trigger').click();
      await page.keyboard.up('Alt');
      const assertMenus = async () => {
        expect(
          await page.locator('#menu-drawing-portal').getAttribute('data-closed-by'),
        ).toBeNull();
        expect(await page.locator('#menu-drawing-portal').isVisible()).toBe(true);
        expect(
          await page
            .locator('#native-drawing-menu')
            .evaluate((element) => element.matches(':popover-open')),
        ).toBe(true);
        expect(await page.evaluate(() => document.activeElement?.id)).toBe('menu-drawing-trigger');
      };
      const activate = async (control: Locator) => {
        if (confirmation !== 'touch') await control.click();
        else {
          const bounds = (await control.boundingBox())!;
          const session = await page.context().newCDPSession(page);
          try {
            await session.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }],
            });
            await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } finally {
            await session.detach();
          }
        }
        await assertMenus();
      };
      for (const name of ['Select', 'Arrow', 'Ellipse', 'Pen', 'Rectangle']) {
        const button = editor.getByRole('button', { name, exact: true });
        await activate(button);
        expect(await button.getAttribute('aria-pressed')).toBe('true');
      }
      const color = editor.getByRole('button', { name: 'Color', exact: true });
      const palette = editor.getByRole('dialog', { name: 'Color palette' });
      await activate(color);
      expect(await palette.isVisible()).toBe(true);
      await activate(palette.getByRole('button', { name: 'Color #22c55e', exact: true }));
      expect(await color.getAttribute('data-tooltip')).toContain('Green');
      await activate(color);
      await activate(palette.getByRole('button', { name: 'Color #ef4444', exact: true }));
      const width = editor.getByRole('button', { name: 'Line width', exact: true });
      await activate(width);
      const widths = editor.getByRole('listbox', { name: 'Line widths' });
      expect(await widths.isVisible()).toBe(true);
      await page.screenshot({
        path: resolve(
          import.meta.dirname,
          '../../../output/playwright/milestone-three-toolbar-width.png',
        ),
      });
      await activate(widths.getByRole('option', { name: '5 px', exact: true }));
      expect((await width.textContent())?.trim()).toBe('5 px');
      // Toolbar padding also belongs to the tool, not to the host menu.
      const toolbar = (await editor.getByRole('toolbar').boundingBox())!;
      await page.mouse.click(toolbar.x + 3, toolbar.y + 3);
      await assertMenus();
      await page.mouse.move(55, 155);
      await page.mouse.down();
      await page.mouse.move(240, 280, { steps: 8 });
      await page.mouse.up();
      expect(await page.locator('#menu-drawing-portal').getAttribute('data-closed-by')).toBeNull();
      expect(await page.locator('#menu-drawing-portal').isVisible()).toBe(true);
      expect(
        await page
          .locator('#native-drawing-menu')
          .evaluate((element) => element.matches(':popover-open')),
      ).toBe(true);
      expect(await editor.locator('[data-shape]').count()).toBe(1);
      expect(await editor.locator('[data-shape]').getAttribute('stroke-width')).toBe('5');
      await activate(color);
      await activate(palette.getByRole('button', { name: 'Color #3b82f6', exact: true }));
      expect(await editor.locator('[data-shape]').getAttribute('stroke')).toBe('#3b82f6');
      await activate(editor.getByRole('button', { name: 'Undo', exact: true }));
      expect(await editor.locator('[data-shape]').getAttribute('stroke')).toBe('#ef4444');
      await activate(editor.getByRole('button', { name: 'Redo', exact: true }));
      expect(await editor.locator('[data-shape]').getAttribute('stroke')).toBe('#3b82f6');
      // Reselect the existing shape, restore red, delete and undo the deletion.
      await page.mouse.click(55, 220);
      await activate(color);
      await activate(palette.getByRole('button', { name: 'Color #ef4444', exact: true }));
      await activate(editor.getByRole('button', { name: 'Delete shape', exact: true }));
      expect(await editor.locator('[data-shape]').count()).toBe(0);
      await activate(editor.getByRole('button', { name: 'Undo', exact: true }));
      expect(await editor.locator('[data-shape]').count()).toBe(1);
      await page.mouse.move(815, 155);
      await page.mouse.down();
      await page.mouse.move(980, 270, { steps: 8 });
      await page.mouse.up();
      expect(
        await page
          .locator('#native-drawing-menu')
          .evaluate((element) => element.matches(':popover-open')),
      ).toBe(true);
      expect(await editor.locator('[data-shape]').count()).toBe(2);
      await page.screenshot({
        path: resolve(
          import.meta.dirname,
          '../../../output/playwright/milestone-three-menu-drawing.png',
        ),
      });
      if (confirmation === 'button')
        await editor.getByRole('button', { name: 'Capture and attach' }).click();
      else if (confirmation === 'touch') {
        const button = (await editor
          .getByRole('button', { name: 'Capture and attach' })
          .boundingBox())!;
        const touch = await page.context().newCDPSession(page);
        try {
          await touch.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: button.x + button.width / 2, y: button.y + button.height / 2 }],
          });
          await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        } finally {
          await touch.detach();
        }
      } else await page.keyboard.press('Meta+Enter');
      await markers.getByRole('img', { name: 'Attached image 1' }).waitFor({ timeout: 10000 });
      const pixels = await markers.getByRole('img').evaluate(async (element) => {
        const image = element as HTMLImageElement;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          menu: [...context.getImageData(100, 220, 1, 1).data],
          popover: [...context.getImageData(900, 220, 1, 1).data],
          stroke: [...context.getImageData(55, 220, 1, 1).data],
        };
      });
      expect(
        pixels.menu.every((value, index) => Math.abs(value - [20, 80, 180, 255][index]!) < 4),
      ).toBe(true);
      expect(
        pixels.popover.every((value, index) => Math.abs(value - [20, 180, 80, 255][index]!) < 4),
      ).toBe(true);
      expect(pixels.stroke[0]).toBeGreaterThan(180);
      // Start a second drawing session, then confirm native host behavior still works.
      await markers.getByRole('button', { name: 'Screenshot', exact: true }).click();
      await editor.locator('.drawing-surface').waitFor({ timeout: 10000 });
      await page.keyboard.down('Alt');
      await page.locator('#menu-drawing-trigger').click();
      await page.mouse.click(600, 100);
      await page.keyboard.up('Alt');
      expect(await page.locator('#menu-drawing-portal').isVisible()).toBe(false);
      expect(
        await page
          .locator('#native-drawing-menu')
          .evaluate((element) => element.matches(':popover-open')),
      ).toBe(false);
      await page.keyboard.down('Alt');
      await page.locator('#menu-drawing-trigger').click();
      await page.keyboard.up('Alt');
      await activate(editor.getByRole('button', { name: 'Cancel drawing', exact: true }));
      expect(await editor.count()).toBe(0);
    });
  },
  60000,
);

it('scopes drawing shortcuts to the editor and exposes every toolbar action with a tooltip', async () => {
  await withEditor(async (page) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'keys.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
    const editor = page.locator('[data-ainotation-ui="drawing"]');
    await editor.locator('.drawing-surface').waitFor();
    expect(await editor.locator('.hint').count()).toBe(0);
    expect(await editor.getByRole('status').count()).toBe(0);
    const colorButton = editor.getByRole('button', { name: 'Color', exact: true });
    const palette = editor.getByRole('dialog', { name: 'Color palette' });
    expect(await editor.getByRole('toolbar').locator('.swatch').count()).toBe(1);
    await colorButton.click();
    expect(await palette.isVisible()).toBe(true);
    expect(await palette.getByRole('button').count()).toBe(6);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-colors.png'),
    });
    await page.keyboard.press('Escape');
    expect(await palette.count()).toBe(0);
    expect(await editor.count()).toBe(1);
    await colorButton.click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    expect(await colorButton.getAttribute('data-tooltip')).toContain('Amber');
    expect(await palette.count()).toBe(0);
    await page.keyboard.press('c');
    expect(await colorButton.getAttribute('data-tooltip')).toContain('Green');
    await colorButton.click();
    await palette.getByRole('button', { name: 'Color #ef4444', exact: true }).click();
    expect(await colorButton.getAttribute('data-tooltip')).toContain('Red');
    // Keyboard activation may enter the popover; pointer activation never steals host focus.
    const widthsButton = editor.getByRole('button', { name: 'Line width', exact: true });
    const widthsList = editor.getByRole('listbox', { name: 'Line widths' });
    await widthsButton.focus();
    await page.keyboard.press('Enter');
    expect(await widthsList.isVisible()).toBe(true);
    expect(
      await widthsList
        .getByRole('option', { name: '3 px', exact: true })
        .evaluate((element) => element.matches(':focus')),
    ).toBe(true);
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    expect((await widthsButton.textContent())?.trim()).toBe('4 px');
    expect(await widthsButton.evaluate((element) => element.matches(':focus'))).toBe(true);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    expect(await widthsList.count()).toBe(0);
    await widthsButton.click();
    await widthsList.getByRole('option', { name: '3 px', exact: true }).click();
    await widthsButton.click();
    await colorButton.click();
    expect(await widthsList.count()).toBe(0);
    expect(await palette.isVisible()).toBe(true);
    await page.keyboard.press('Escape');
    expect(
      await editor
        .getByRole('toolbar')
        .locator('button,select')
        .evaluateAll((actions) =>
          actions.every(
            (action) =>
              action.getAttribute('data-tooltip') && action.getAttribute('aria-keyshortcuts'),
          ),
        ),
    ).toBe(true);
    const tooltip = editor.getByRole('tooltip');
    const actions = editor.getByRole('toolbar').locator('button,select');
    for (const action of await actions.all()) {
      await action.hover();
      expect(await tooltip.isVisible()).toBe(true);
      expect(await tooltip.textContent()).toBe(await action.getAttribute('data-tooltip'));
      expect(await action.getAttribute('aria-describedby')).toBe('ainotation-drawing-tooltip');
    }
    await page.mouse.move(20, 20);
    expect(await tooltip.isVisible()).toBe(false);
    await editor.getByRole('button', { name: 'Arrow', exact: true }).focus();
    expect(await tooltip.textContent()).toBe('Arrow (A)');
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-tooltip.png'),
    });
    await page.evaluate(() => {
      document.documentElement.dataset.drawingKeys = '';
      document.addEventListener('keydown', (event) => {
        document.documentElement.dataset.drawingKeys += event.key;
      });
    });
    for (const [key, name] of [
      ['v', 'Select'],
      ['r', 'Rectangle'],
      ['e', 'Ellipse'],
      ['f', 'Pen'],
      ['a', 'Arrow'],
    ]) {
      await page.keyboard.press(key!);
      expect(
        await editor.getByRole('button', { name: name!, exact: true }).getAttribute('aria-pressed'),
      ).toBe('true');
    }
    expect(await page.evaluate(() => document.documentElement.dataset.drawingKeys)).toBe('');
    await draw(page);
    const shape = editor.locator('[data-shape]');
    for (const color of ['#f59e0b', '#22c55e', '#3b82f6', '#ffffff', '#111827', '#ef4444']) {
      await page.keyboard.press('c');
      expect(await shape.getAttribute('stroke')).toBe(color);
    }
    await colorButton.click();
    await palette.getByRole('button', { name: 'Color #111827', exact: true }).click();
    expect(await shape.getAttribute('stroke')).toBe('#111827');
    for (const key of ['o', '1', '2', '3', '4', '5', '6', 'Delete', 'Backspace'])
      await page.keyboard.press(key);
    expect(await shape.getAttribute('stroke')).toBe('#111827');
    expect(
      await editor.getByRole('button', { name: 'Arrow', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
    for (const width of ['4', '5', '0.5', '1', '1.5', '2', '3']) {
      await page.keyboard.press('s');
      expect(await shape.getAttribute('stroke-width')).toBe(width);
      expect(
        (
          await editor.getByRole('button', { name: 'Line width', exact: true }).textContent()
        )?.trim(),
      ).toBe(`${width} px`);
    }
    await page.keyboard.down('s');
    await page.keyboard.down('s');
    await page.keyboard.up('s');
    expect(await shape.getAttribute('stroke-width')).toBe('4');
    await page.keyboard.press('Meta+z');
    expect(await shape.getAttribute('stroke-width')).toBe('3');
    await page.keyboard.press('Meta+Shift+z');
    expect(await shape.getAttribute('stroke-width')).toBe('4');
    await page.keyboard.press('Control+z');
    expect(await shape.getAttribute('stroke-width')).toBe('3');
    await page.keyboard.press('Control+Shift+z');
    expect(await shape.getAttribute('stroke-width')).toBe('4');
    await page.keyboard.down('Alt');
    await page.keyboard.press('r');
    await page.keyboard.press('s');
    await page.keyboard.press('c');
    await page.keyboard.up('Alt');
    expect(
      await editor.getByRole('button', { name: 'Arrow', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(await shape.getAttribute('stroke-width')).toBe('4');
    expect(await shape.getAttribute('stroke')).toBe('#111827');
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'drawing-key-input';
      document.body.append(input);
      input.focus();
    });
    await page.keyboard.type('vraefscd');
    expect(await page.locator('#drawing-key-input').inputValue()).toBe('vraefscd');
    expect(
      await editor.getByRole('button', { name: 'Arrow', exact: true }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(await shape.getAttribute('stroke-width')).toBe('4');
    const strokePoint = await shape.evaluate((element) => {
      const path = element.lastElementChild as SVGGeometryElement;
      const point = path.getPointAtLength(path.getTotalLength() / 3);
      const position = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      return { x: position.x, y: position.y };
    });
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.mouse.click(strokePoint.x, strokePoint.y);
    await page.keyboard.press('d');
    expect(await shape.count()).toBe(0);
    await page.keyboard.press('Meta+z');
    expect(await shape.count()).toBe(1);
    await page.keyboard.press('Escape');
    expect(await editor.count()).toBe(0);
    await page.evaluate(() => {
      document.documentElement.dataset.drawingKeys = '';
    });
    await page.keyboard.press('r');
    await page.keyboard.press('s');
    expect(await page.evaluate(() => document.documentElement.dataset.drawingKeys)).toBe('rs');
  });
}, 60000);

it('uses one small handle to resize and rotate while dragging shape strokes moves them', async () => {
  await withEditor(async (page) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 500;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'white';
      context.fillRect(0, 0, 800, 500);
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'handles.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
    const editor = page.locator('[data-ainotation-ui="drawing"]');
    const surface = editor.locator('.drawing-surface');
    await surface.waitFor();
    const drag = async (start: { x: number; y: number }, end: { x: number; y: number }) => {
      await page.mouse.move(start.x, start.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 8 });
      await page.mouse.up();
    };
    const handlePoint = async () => {
      const handle = editor.locator('.control-handle');
      expect(await handle.count()).toBe(1);
      const box = (await handle.boundingBox())!;
      expect(box.width).toBeLessThan(10);
      expect(box.height).toBeLessThan(10);
      await expect
        .poll(() =>
          handle.evaluate((element) => {
            const rect = element as SVGRectElement;
            const matrix = rect.getScreenCTM()!;
            return rect.width.baseVal.value * Math.hypot(matrix.a, matrix.b);
          }),
        )
        .toBeCloseTo(6);
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const box = (await surface.boundingBox())!;
    const start = { x: box.x + 140, y: box.y + 120 };
    const end = { x: box.x + 340, y: box.y + 240 };
    await drag(start, end);
    const tail = await handlePoint();
    expect(tail.x).toBeCloseTo(start.x);
    expect(tail.y).toBeCloseTo(start.y);
    await drag({ x: tail.x - 8, y: tail.y }, { x: tail.x + 22, y: tail.y + 30 });
    expect(await editor.locator('[data-shape]').count()).toBe(1);
    const path = editor.locator('[data-shape] > path');
    const movedTail = await path.getAttribute('d');
    expect(movedTail).toContain('L340,240');
    const tailAfter = await handlePoint();
    expect(tailAfter.x).toBeCloseTo(tail.x + 30);
    expect(tailAfter.y).toBeCloseTo(tail.y + 30);
    const lineWidth = editor.getByRole('button', { name: 'Line width', exact: true });
    expect((await lineWidth.textContent())?.trim()).toBe('3 px');
    await lineWidth.click();
    const widths = editor.getByRole('listbox', { name: 'Line widths' });
    expect(
      await widths
        .getByRole('option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('aria-label'))),
    ).toEqual(['0.5 px', '1 px', '1.5 px', '2 px', '3 px', '4 px', '5 px']);
    await page.keyboard.press('Escape');
    for (const value of ['0.5', '1', '1.5', '2', '3', '4', '5']) {
      await lineWidth.click();
      await widths.getByRole('option', { name: `${value} px`, exact: true }).click();
      expect(await editor.locator('[data-shape]').getAttribute('stroke-width')).toBe(value);
    }
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await editor.locator('[data-shape]').getAttribute('stroke-width')).toBe('4');
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await editor.locator('[data-shape]').getAttribute('stroke-width')).toBe('5');
    const midpoint = { x: (tailAfter.x + end.x) / 2, y: (tailAfter.y + end.y) / 2 };
    await drag(midpoint, { x: midpoint.x + 25, y: midpoint.y - 20 });
    expect((await handlePoint()).x).toBeCloseTo(tailAfter.x + 25);
    expect(await editor.locator('[data-shape]').count()).toBe(1);
    await editor.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await path.getAttribute('d')).toBe(movedTail);
    await editor.getByRole('button', { name: 'Redo', exact: true }).click();
    await editor.getByRole('button', { name: 'Select', exact: true }).click();
    await page.mouse.click(midpoint.x + 25, midpoint.y - 20);
    await editor.getByRole('button', { name: 'Delete shape', exact: true }).click();

    for (const tool of ['Rectangle', 'Ellipse', 'Pen']) {
      await editor.getByRole('button', { name: tool, exact: true }).click();
      // Reverse drawing direction makes the pen's last point its top-left.
      await drag(end, start);
      expect(await editor.locator('[data-shape]').getAttribute('stroke-width')).toBe('5');
      const corner = await handlePoint();
      expect(corner.x).toBeCloseTo(end.x);
      expect(corner.y).toBeCloseTo(end.y);
      await drag(corner, { x: corner.x + 40, y: corner.y + 30 });
      const bigger = await handlePoint();
      expect(bigger.x).toBeCloseTo(end.x + 40);
      expect(bigger.y).toBeCloseTo(end.y + 30);
      const shape = editor.locator('[data-shape]');
      const oldTransform = await shape.getAttribute('transform');
      const rotateStart = { x: bigger.x + 18, y: bigger.y + 4 };
      await page.mouse.move(rotateStart.x, rotateStart.y);
      expect(
        await editor
          .locator('[data-control="rotate"]')
          .evaluate((el) => getComputedStyle(el).cursor),
      ).toContain('url(');
      await page.mouse.down();
      await page.mouse.move(bigger.x - 90, bigger.y + 85, { steps: 8 });
      const rotatingCursor = await surface.evaluate(async (element) => {
        const cursor = getComputedStyle(element).cursor;
        const url = /url\("([^"]+)"\)/.exec(cursor)?.[1];
        if (!url) throw new Error('Rotation cursor was lost during pointer capture');
        const image = new Image();
        image.src = url;
        await image.decode();
        const svg = new DOMParser().parseFromString(
          decodeURIComponent(url.split(',')[1]!),
          'image/svg+xml',
        );
        return {
          cursor,
          angle: Number(
            svg
              .querySelector('g')!
              .getAttribute('transform')!
              .match(/rotate\(([-\d.]+)/)![1],
          ),
        };
      });
      const shapeAngle = Number(
        (await shape.getAttribute('transform'))!.match(/rotate\(([-\d.]+)/)![1],
      );
      expect(Math.abs(rotatingCursor.angle - ((shapeAngle + 90) % 360))).toBeLessThanOrEqual(0.05);
      expect(await shape.evaluate((element) => getComputedStyle(element).cursor)).toBe(
        rotatingCursor.cursor,
      );
      await page.mouse.up();
      expect(await surface.evaluate((element) => element.classList.contains('rotating'))).toBe(
        false,
      );
      expect(
        await editor
          .locator('[data-control="rotate"]')
          .evaluate((element) => getComputedStyle(element).cursor),
      ).toBe(rotatingCursor.cursor);
      expect(await shape.getAttribute('transform')).not.toBe(oldTransform);
      expect(await shape.count()).toBe(1);
      const rotation = await shape.getAttribute('transform');
      const cornerRotated = await handlePoint();
      await drag(cornerRotated, { x: cornerRotated.x + 20, y: cornerRotated.y + 20 });
      const afterResize = await shape.getAttribute('transform');
      expect(afterResize!.split(' ')[0]).toBe(rotation!.split(' ')[0]);
      await editor.getByRole('button', { name: 'Undo', exact: true }).click();
      expect(await shape.getAttribute('transform')).toBe(rotation);
      await editor.getByRole('button', { name: 'Redo', exact: true }).click();
      if (tool !== 'Pen') {
        await editor.getByRole('button', { name: 'Select', exact: true }).click();
        const stroke = await shape.evaluate((element) => {
          const geometry = element.lastElementChild as SVGGeometryElement;
          const p = geometry.getPointAtLength(geometry.getTotalLength() * 0.4);
          const position = new DOMPoint(p.x, p.y).matrixTransform(geometry.getScreenCTM()!);
          return { x: position.x, y: position.y };
        });
        await page.mouse.click(stroke.x, stroke.y);
        await editor.getByRole('button', { name: 'Delete shape', exact: true }).click();
      }
    }
    // Reselect the transformed pen, and verify CSS-size handles on a scaled image.
    await editor.getByRole('button', { name: 'Select', exact: true }).click();
    const stroke = await editor.locator('[data-shape]').evaluate((element) => {
      const line = element.lastElementChild as SVGGeometryElement;
      const p = line.getPointAtLength(line.getTotalLength() / 2);
      const position = new DOMPoint(p.x, p.y).matrixTransform(line.getScreenCTM()!);
      return { x: position.x, y: position.y };
    });
    await page.mouse.click(stroke.x, stroke.y);
    await page.setViewportSize({ width: 600, height: 700 });
    await handlePoint();
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-handle.png'),
    });
    await editor.getByRole('button', { name: 'Attach image', exact: true }).click();
    await markers.getByRole('img', { name: 'Attached image 1' }).waitFor();
    const result = await markers.getByRole('img').evaluate(async (element) => {
      const image = element as HTMLImageElement;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let blue = 0,
        red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 2]! > pixels[i]! + 20) blue++;
        if (pixels[i]! > pixels[i + 2]! + 50) red++;
      }
      return { blue, red };
    });
    expect(result.blue).toBe(0);
    expect(result.red).toBeGreaterThan(100);
  });
}, 60000);

it('imports, draws, persists and exports image feedback with PNG content retrievable through MCP', async () => {
  await withEditor(async (page, client) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const shell = page.locator('ainotation-inspector-shell');
    await markers.getByRole('textbox').fill('Illustrated feedback');
    const base64 = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, 640, 360);
      return canvas.toDataURL().split(',')[1]!;
    });
    await markers.locator('input[type=file]').setInputFiles({
      name: 'external.png',
      mimeType: 'image/png',
      buffer: Buffer.from(base64, 'base64'),
    });
    await draw(page);
    const drawing = page.locator('[data-ainotation-ui="drawing"]');
    await drawing.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await drawing.locator('[data-shape]').count()).toBe(0);
    await drawing.getByRole('button', { name: 'Redo', exact: true }).click();
    expect(await drawing.locator('[data-shape]').count()).toBe(1);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-import.png'),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const attachBounds = await drawing
      .getByRole('button', { name: 'Attach image', exact: true })
      .boundingBox();
    expect(attachBounds).not.toBeNull();
    expect(attachBounds!.x + attachBounds!.width).toBeLessThanOrEqual(390);
    expect(attachBounds!.y + attachBounds!.height).toBeLessThanOrEqual(844);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-mobile.png'),
    });
    await drawing.getByRole('button', { name: 'Attach image', exact: true }).click();
    await markers.getByRole('img', { name: 'Attached image 1' }).waitFor();
    await markers.getByRole('button', { name: 'Add', exact: true }).click();
    await expect
      .poll(() =>
        shell.evaluate(
          (el) => (el as InspectorShell).view.document?.annotations[0]?.images?.length,
        ),
      )
      .toBe(1);
    const feedback = await shell.evaluate((el) => (el as InspectorShell).view.document!);
    const image = feedback.annotations[0]!.images![0]!;
    await expect
      .poll(
        async () =>
          (
            await client.callTool({
              name: 'ainotation_get_image',
              arguments: { sessionId: feedback.id, imageId: image.id },
            })
          ).isError,
        { timeout: 15000 },
      )
      .not.toBe(true);
    const response = await client.callTool({
      name: 'ainotation_get_image',
      arguments: { sessionId: feedback.id, imageId: image.id },
    });
    const content = response.content as { type: string; data: string; mimeType: string }[];
    expect(content[0]).toMatchObject({ type: 'image', mimeType: 'image/png' });
    expect(content[0]!.data).not.toBe(base64);
    expect(
      await page.evaluate(async (encoded) => {
        const image = new Image();
        image.src = `data:image/png;base64,${encoded}`;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let red = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i]! > 180 && pixels[i + 1]! < 130 && pixels[i + 2]! < 130) red++;
        return red;
      }, content[0]!.data),
    ).toBeGreaterThan(300);
    const downloaded = page.waitForEvent('download');
    await shell.getByRole('button', { name: 'Export feedback and images' }).click();
    const zip = await downloaded;
    expect(zip.suggestedFilename()).toBe(`ainotation-${feedback.id}.zip`);
    await page.reload();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
    await markers.getByRole('img', { name: 'Attached image 1' }).waitFor();
    const imageSrc = await markers.getByRole('img').getAttribute('src');
    expect(imageSrc).toMatch(/^blob:/);
    await markers.getByRole('img', { name: 'Attached image 1' }).hover();
    await markers.getByRole('button', { name: 'Remove image 1' }).click();
    await markers.getByRole('button', { name: 'Save', exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await client.callTool({
              name: 'ainotation_get_image',
              arguments: { sessionId: feedback.id, imageId: image.id },
            })
          ).isError,
      )
      .toBe(true);
  });
}, 60000);

it('captures a real browser tab after live drawing and temporary Alt interaction', async () => {
  await withEditor(async (page) => {
    const markers = page.locator('[data-ainotation-ui="markers"]');
    await markers.getByRole('textbox').fill('Live screen feedback');
    await page.evaluate(() => {
      const native = navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getDisplayMedia = async (options) => {
        const stream = await native(options);
        (window as Window & { testCapture?: MediaStream }).testCapture = stream;
        return stream;
      };
      const button = document.createElement('button');
      button.id = 'drawing-host-action';
      button.textContent = 'Host action';
      button.style.cssText =
        'position:fixed;top:120px;left:30px;width:130px;height:40px;z-index:1000';
      button.dataset.clicks = '0';
      button.onclick = () => {
        button.dataset.clicks = String(Number(button.dataset.clicks) + 1);
      };
      document.body.append(button);
      const tooltip = document.createElement('div');
      tooltip.id = 'drawing-tooltip';
      tooltip.textContent = 'Hover state';
      tooltip.style.cssText =
        'position:fixed;left:30px;top:170px;width:180px;height:40px;background:rgb(18,52,240);color:white;display:none;z-index:1000';
      button.addEventListener('mouseenter', () => {
        tooltip.style.display = 'block';
      });
      button.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
      document.body.append(tooltip);
      const modal = document.createElement('dialog');
      modal.id = 'drawing-modal';
      modal.innerHTML = '<button id="drawing-modal-close">Close test modal</button>';
      document.body.append(modal);
      modal.querySelector('button')!.addEventListener('click', () => modal.close());
    });
    await markers.getByRole('button', { name: 'Screenshot', exact: true }).click();
    const editor = page.locator('[data-ainotation-ui="drawing"]');
    await editor.locator('.drawing-surface').waitFor({ timeout: 10000 });
    await draw(page);
    await page.keyboard.down('Alt');
    await page.locator('#drawing-host-action').click();
    await page.keyboard.up('Alt');
    expect(await page.locator('#drawing-host-action').getAttribute('data-clicks')).toBe('1');
    expect(await editor.locator('[data-shape]').count()).toBe(1);
    await page.evaluate(() =>
      (document.querySelector('#drawing-modal') as HTMLDialogElement).showModal(),
    );
    await editor.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(400, 350);
    await page.mouse.down();
    await page.mouse.move(700, 500);
    await page.mouse.up();
    expect(await editor.locator('[data-shape]').count()).toBe(2);
    await page.keyboard.down('Alt');
    await page.locator('#drawing-modal-close').click();
    await page.keyboard.up('Alt');
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-three-live.png'),
    });
    await page.keyboard.down('Alt');
    await page.locator('#drawing-host-action').hover();
    expect(await page.locator('#drawing-tooltip').isVisible()).toBe(true);
    await page.keyboard.press('Meta+Enter');
    await expect
      .poll(
        async () =>
          (await markers.getByRole('img', { name: 'Attached image 1' }).isVisible())
            ? 'attached'
            : editor.getByRole('status').textContent(),
        { timeout: 10000 },
      )
      .toBe('attached');
    expect(await editor.count()).toBe(0);
    await page.keyboard.up('Alt');
    const shell = page.locator('ainotation-inspector-shell');
    const images = await shell.evaluate((el) => (el as InspectorShell).view.images);
    expect(images[0]).toMatchObject({ source: 'screen', width: 1280, height: 900 });
    const rendered = await markers
      .getByRole('img', { name: 'Attached image 1' })
      .evaluate(async (element) => {
        const image = element as HTMLImageElement;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d')!;
        context.drawImage(image, 0, 0);
        return {
          tooltip: [...context.getImageData(35, 175, 1, 1).data],
          controls: [...context.getImageData(910, 860, 1, 1).data],
        };
      });
    // Display capture may round a color channel during video color conversion.
    expect(
      rendered.tooltip.every(
        (channel, index) => Math.abs(channel - [18, 52, 240, 255][index]!) <= 3,
      ),
    ).toBe(true);
    expect(rendered.controls.slice(0, 3).every((channel) => channel > 200)).toBe(true);
    expect(
      await page.evaluate(() =>
        (window as Window & { testCapture?: MediaStream }).testCapture
          ?.getTracks()
          .every((track) => track.readyState === 'ended'),
      ),
    ).toBe(true);
    await markers.getByRole('img', { name: 'Attached image 1' }).hover();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      markers.getByRole('button', { name: 'Download image 1' }).click(),
    ]);
    await download.saveAs(
      resolve(import.meta.dirname, '../../../output/playwright/milestone-three-captured.png'),
    );
    await markers.getByRole('button', { name: 'Add', exact: true }).click();
  });
}, 60000);
