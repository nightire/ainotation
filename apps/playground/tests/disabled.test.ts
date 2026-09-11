import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium, type Locator, type Page } from 'playwright';
import type { InspectorShell } from '@ainotation/sdk/ui';

async function withPicker(mobile: boolean, run: (page: Page) => Promise<void>) {
  const web = await createPlaygroundServer(import.meta.url);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({
      viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
      isMobile: mobile,
      hasTouch: mobile,
    });
    const page = await context.newPage();
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await page.evaluate(() => {
      const fixture = document.createElement('section');
      fixture.id = 'disabled-fixture';
      fixture.style.cssText =
        'position:fixed;left:50px;top:100px;width:180px;z-index:100;background:white;display:grid;gap:6px;';
      fixture.innerHTML = `
        <style>
          #disabled-fixture :is(button,input,select,textarea) {
            box-sizing:border-box;display:block;width:180px;height:30px;min-height:0;
            margin:0;padding:2px;border:1px solid black;font:12px sans-serif;
          }
          #disabled-fixture fieldset { margin:0;padding:0;border:0;min-width:0; }
          #disabled-fixture legend { padding:0; }
          #disabled-span { display:block; }
        </style>
        <button id="disabled-button" disabled>Disabled text</button>
        <button id="disabled-nested" disabled><span id="disabled-span">Nested text</span></button>
        <input id="disabled-input" disabled value="Disabled input">
        <select id="disabled-select" disabled><option>Disabled option</option></select>
        <textarea id="disabled-textarea" disabled>Disabled textarea</textarea>
        <fieldset id="disabled-fieldset" disabled>
          <legend><button id="legend-enabled">Enabled first legend</button></legend>
          <input id="fieldset-input" value="Inherited disabled">
        </fieldset>
        <button id="normal-enabled">Enabled outside fieldset</button>
        <div id="disabled-shadow-host"></div>
      `;
      const root = fixture.querySelector('#disabled-shadow-host')!.attachShadow({ mode: 'open' });
      root.innerHTML =
        '<button id="shadow-disabled" disabled style="box-sizing:border-box;width:180px;height:30px">Shadow disabled</button>';
      fixture.dataset.clicks = '0';
      fixture.dataset.inputs = '0';
      fixture.addEventListener('click', () => {
        fixture.dataset.clicks = String(Number(fixture.dataset.clicks) + 1);
      });
      fixture.addEventListener('input', () => {
        fixture.dataset.inputs = String(Number(fixture.dataset.inputs) + 1);
      });
      document.body.append(fixture);
    });
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    const launcher = shell.getByRole('button', { name: 'Open inspector', exact: true });
    if (mobile) await launcher.tap();
    else await launcher.click();
    await expect.poll(() => shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await run(page);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([browser?.close(), web.close()]);
  }
}

async function center(locator: Locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Missing control bounds');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function disabledState(page: Page) {
  return page.locator('#disabled-fixture').evaluate((fixture) => {
    const selector = 'button,input,select,textarea,fieldset';
    const controls = [
      ...fixture.querySelectorAll(selector),
      ...fixture.querySelector('#disabled-shadow-host')!.shadowRoot!.querySelectorAll(selector),
    ];
    return controls.map((control) => ({
      id: control.id,
      disabled: (control as HTMLInputElement).disabled,
      attribute: control.getAttribute('disabled'),
      effective: control.matches(':disabled'),
    }));
  });
}

it('picks native disabled controls with real mouse input without enabling or activating them', async () => {
  await withPicker(false, async (page) => {
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog', { name: 'New feedback', exact: true });
    const pending = markers.getByRole('button', { name: 'New annotation', exact: true });
    const view = () => shell.evaluate((el) => (el as InspectorShell).view);
    const initial = await disabledState(page);
    expect(initial).toEqual([
      ...[
        'disabled-button',
        'disabled-nested',
        'disabled-input',
        'disabled-select',
        'disabled-textarea',
        'disabled-fieldset',
      ].map((id) => ({ id, disabled: true, attribute: '', effective: true })),
      { id: 'legend-enabled', disabled: false, attribute: null, effective: false },
      { id: 'fieldset-input', disabled: false, attribute: null, effective: true },
      { id: 'normal-enabled', disabled: false, attribute: null, effective: false },
      { id: 'shadow-disabled', disabled: true, attribute: '', effective: true },
    ]);
    const click = async (id: string) => {
      const point = await center(page.locator(`#${id}`));
      // Native disabled controls suppress click; exercise the real pointer sequence.
      await page.mouse.click(point.x, point.y);
      return point;
    };
    const cancel = async () => {
      await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
      await editor.waitFor({ state: 'detached' });
      expect(await pending.count()).toBe(0);
    };

    for (const [hit, id, tagName] of [
      ['disabled-button', 'disabled-button', 'button'],
      ['disabled-span', 'disabled-nested', 'button'],
      ['disabled-input', 'disabled-input', 'input'],
      ['disabled-select', 'disabled-select', 'select'],
      ['disabled-textarea', 'disabled-textarea', 'textarea'],
      ['fieldset-input', 'fieldset-input', 'input'],
      ['legend-enabled', 'legend-enabled', 'button'],
      ['normal-enabled', 'normal-enabled', 'button'],
      ['shadow-disabled', 'shadow-disabled', 'button'],
    ] as const) {
      const point = await click(hit);
      await editor.waitFor();
      expect(await editor.count()).toBe(1);
      expect((await view()).selected).toHaveLength(1);
      const target = (await view()).selected[0]!;
      expect(target).toMatchObject({
        selector: `#${id}`,
        tagName,
        attributes: { id },
        shadowHosts: id === 'shadow-disabled' ? ['#disabled-shadow-host'] : [],
      });
      expect(target.attributes.disabled).toBe(
        initial.find((control) => control.id === id)!.attribute ?? undefined,
      );
      const marker = (await pending.boundingBox())!;
      expect(marker.width).toBeGreaterThanOrEqual(24);
      expect(marker.height).toBeGreaterThanOrEqual(24);
      expect(marker.x + marker.width / 2).toBeCloseTo(point.x, 0);
      expect(marker.y + marker.height / 2).toBeCloseTo(point.y, 0);
      expect(await disabledState(page)).toEqual(initial);
      await cancel();
    }

    for (const ids of [
      ['disabled-button', 'fieldset-input'],
      ['normal-enabled', 'disabled-input'],
    ]) {
      await page.keyboard.down('Shift');
      await click(ids[0]!);
      expect(await editor.count()).toBe(0);
      const point = await click(ids[1]!);
      expect(await editor.count()).toBe(0);
      expect(await pending.count()).toBe(0);
      const selected = (await view()).selected;
      expect(selected.map((target) => target.attributes.id)).toEqual(ids);
      await page.keyboard.up('Shift');
      await editor.waitFor();
      expect(await editor.locator('.target-list li').count()).toBe(2);
      expect((await view()).marker).toMatchObject({ targetId: selected[1]!.id });
      const marker = (await pending.boundingBox())!;
      expect(marker.x + marker.width / 2).toBeCloseTo(point.x, 0);
      expect(marker.y + marker.height / 2).toBeCloseTo(point.y, 0);
      await cancel();
    }

    const point = await center(page.locator('#disabled-button'));
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await page.mouse.move(point.x + 20, point.y, { steps: 4 });
    await page.mouse.up();
    expect(await editor.count()).toBe(0);
    expect(await pending.count()).toBe(0);
    expect((await view()).selected).toHaveLength(0);
    await click('disabled-button');
    await editor.waitFor();
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Annotate a disabled control.');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).waitFor();
    const annotations = (await view()).document!.annotations;
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({
      comment: 'Annotate a disabled control.',
      targets: [{ tagName: 'button', attributes: { id: 'disabled-button', disabled: '' } }],
    });
    expect(await page.locator('#disabled-fixture').getAttribute('data-clicks')).toBe('0');
    expect(await page.locator('#disabled-fixture').getAttribute('data-inputs')).toBe('0');

    await page.keyboard.press('Alt+Shift+KeyA');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).waitFor();
    expect((await view()).picking).toBe(false);
    await click('normal-enabled');
    await click('legend-enabled');
    expect(await page.locator('#disabled-fixture').getAttribute('data-clicks')).toBe('2');
    await click('disabled-button');
    await click('fieldset-input');
    await click('shadow-disabled');
    expect(await page.locator('#disabled-fixture').getAttribute('data-clicks')).toBe('2');
    expect(await page.locator('#disabled-fixture').getAttribute('data-inputs')).toBe('0');
    expect(await disabledState(page)).toEqual(initial);
    expect((await view()).document!.annotations).toEqual(annotations);
    expect((await view()).selected).toHaveLength(0);
    expect(await editor.count()).toBe(0);
  });
});

it('picks and saves a disabled control once with a real mobile touch', async () => {
  await withPicker(true, async (page) => {
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog', { name: 'New feedback', exact: true });
    const initial = await disabledState(page);
    const point = await center(page.locator('#disabled-button'));
    expect(await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.id, point)).toBe(
      'disabled-button',
    );
    await page.touchscreen.tap(point.x, point.y);
    await editor.waitFor();
    expect(await editor.count()).toBe(1);
    expect(await markers.getByRole('button', { name: 'New annotation', exact: true }).count()).toBe(
      1,
    );
    const selected = await shell.evaluate((el) => (el as InspectorShell).view.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      selector: '#disabled-button',
      tagName: 'button',
      attributes: { id: 'disabled-button', disabled: '' },
    });
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Touch feedback.');
    await editor.getByRole('button', { name: 'Add', exact: true }).tap();
    await editor.waitFor({ state: 'detached' });
    await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).waitFor();
    const annotations = await shell.evaluate(
      (el) => (el as InspectorShell).view.document!.annotations,
    );
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toMatchObject({ comment: 'Touch feedback.', targets: selected });
    expect(await markers.getByRole('button', { name: 'New annotation', exact: true }).count()).toBe(
      0,
    );
    expect(await page.locator('#disabled-fixture').getAttribute('data-clicks')).toBe('0');
    expect(await page.locator('#disabled-fixture').getAttribute('data-inputs')).toBe('0');
    expect(await disabledState(page)).toEqual(initial);
  });
});
