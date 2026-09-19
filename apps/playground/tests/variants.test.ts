import { mkdtemp, mkdir, writeFile, readFile, readdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build, createServer, preview } from 'vite-plus';
import { chromium } from 'playwright';
import { expect, it } from 'vite-plus/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createProjectMcpServer } from '@ainotation/mcp/bridge';
import { startSharedService } from '@ainotation/mcp/service';
import { ainotation } from '@ainotation/vite';
import { FeedbackExportSchema } from '@ainotation/schema';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { configurePage, previewVariant } from './helpers';

const hostSource = `
import { defineVariants } from 'virtual:ainotation/variants';
import config from './variants.json';
const group = config ? defineVariants(config) : null;
let cleanups = [];
const root = document.querySelector('#fixture');
function render() {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
  root.replaceChildren();
  const snapshot = group?.getSnapshot() ?? { generation: 0, variantId: 'original' };
  for (let index = 0; index < 2; index++) {
    if (import.meta.env.DEV && snapshot.variantId === 'broken' && index === 1) continue;
    const candidate = import.meta.env.DEV && snapshot.variantId !== 'original';
    const element = document.createElement(index === 0 ? 'button' : candidate ? 'aside' : 'p');
    element.id = index === 0 ? 'target-a' : 'target-b';
    if (candidate) {
      element.className = 'temporary-candidate';
      element.style.cssText = 'padding:16px 24px;border:2px solid #087268;border-radius:16px;background:#e8f1ed;color:#17483d';
      element.innerHTML = '<strong>' + snapshot.variantId + '</strong><span> · design ' + (index + 1) + '</span>';
    } else element.textContent = index === 0 ? 'Original action' : 'Original supporting text';
    if (index === 0) element.onclick = () => document.querySelector('#clicks').textContent = String(Number(document.querySelector('#clicks').textContent) + 1);
    root.append(element);
    if (group) cleanups.push(group.bind(config.targetIds[index], element, snapshot));
  }
}
const unsubscribe = group?.subscribe(render);
render();
if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => { unsubscribe?.(); for (const cleanup of cleanups) cleanup(); group?.dispose(); });
}
`;

it('runs UI Variants through a real host, HMR, MCP decisions, refresh and production fallback', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'ainotation-variants-host-')));
  const root = join(directory, 'app');
  await mkdir(root);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ name: 'variants-host', private: true, type: 'module' }),
  );
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><html lang="en"><head><title>Variants host</title><style>body{font:16px system-ui;padding:48px;background:#f6f8f7}button{padding:12px 20px}#fixture{display:flex;gap:32px;align-items:center}</style></head><body><h1>Explore a coordinated design</h1><div id="fixture"></div><p>Actions: <output id="clicks">0</output></p><script type="module" src="/main.js"></script></body></html>',
  );
  await writeFile(join(root, 'main.js'), hostSource);
  await writeFile(join(root, 'variants.json'), 'null');
  const shared = await startSharedService({ directory: join(directory, 'service') });
  const web = await createServer({
    configFile: false,
    root,
    cacheDir: join(directory, 'cache'),
    logLevel: 'silent',
    plugins: [ainotation({ name: 'variants-host', serviceDirectory: shared.directory })],
    server: { host: '127.0.0.1', port: 0 },
  });
  const bridge = createProjectMcpServer({ directory: root, serviceDirectory: shared.directory });
  const client = new Client({ name: 'variant-agent', version: '1' });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let production: Awaited<ReturnType<typeof preview>> | undefined;
  const consoleMessages: string[] = [];
  const errors: string[] = [];
  try {
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    await web.listen();
    const address = web.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing address');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
    configurePage(page, errors);
    page.on('console', (entry) => consoleMessages.push(entry.text()));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    const shell = page.locator('ainotation-inspector-shell');
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantsSupported), {
        timeout: 15000,
      })
      .toBe(true);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.keyboard.down('Shift');
    await page.locator('#target-a').click();
    await page.locator('#target-b').click();
    await page.keyboard.up('Shift');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const editor = markers.getByRole('dialog');
    await editor.getByRole('switch', { name: 'UI Variants', exact: true }).click();
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Explore two coordinated designs.');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const sessionId = await shell.evaluate(
      (element) => (element as InspectorShell).view.document!.id,
    );
    const call = async (name: string, args: Record<string, unknown>) => {
      const response = await client.callTool({ name, arguments: args });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      return JSON.parse((response.content as { text: string }[])[0]!.text);
    };
    const read = async () =>
      FeedbackExportSchema.parse(await call('ainotation_get_feedback', { sessionId }));
    await expect
      .poll(async () => (await read()).annotations[0]?.variants?.status)
      .toBe('requested');
    const original = (await read()).annotations[0]!;
    expect(original.targets).toHaveLength(2);
    const current = async () => (await read()).annotations[0]!.variants!;
    const group = {
      explorationId: original.variants!.id,
      targetIds: original.variants!.targetIds,
      generations: [{ generation: 1, variants: ['compact', 'bold', 'broken'] }],
    };
    await writeFile(join(root, 'variants.json'), JSON.stringify(group));
    const publish = async (choices: string[]) => {
      const state = await current();
      return call('ainotation_publish_variants', {
        sessionId,
        annotationId: original.id,
        explorationId: state.id,
        generation: state.generation,
        revision: state.revision,
        operationId: crypto.randomUUID(),
        choices: choices.map((id) => ({ id, label: id })),
      });
    };
    await publish(group.generations[0]!.variants);
    const controller = markers.getByRole('region', { name: 'UI Variants', exact: true });
    await expect
      .poll(
        () =>
          shell.evaluate((element) => ({
            ...(element as InspectorShell).view.variantPreview,
            host: [...document.querySelectorAll('[data-ainotation-slot]')].map(
              (node) => node.outerHTML,
            ),
            phase: (element as InspectorShell).view.document?.annotations[0]?.variants?.status,
          })),
        { timeout: 10000 },
      )
      .toMatchObject({ status: 'ready' });
    expect(await controller.locator('.variant-page').textContent()).toBe('Round 1 · 1/4');
    expect(await controller.textContent()).not.toContain(
      'Compare candidates, then record your decision',
    );
    await previewVariant(controller, 'compact');
    expect(await controller.locator('.variant-page').textContent()).toBe('Round 1 · 2/4');
    await expect.poll(() => page.locator('[data-ainotation-variant="compact"]').count()).toBe(2);
    expect(await page.locator('aside#target-b').count()).toBe(1);
    const selectionOverlay = page.locator('[data-ainotation-ui="selection"]');
    await page.locator('#target-a').hover();
    await expect.poll(() => selectionOverlay.locator('.rect').count()).toBe(0);
    expect(await markers.locator('.marker:visible').count()).toBe(0);
    expect(await shell.evaluate((element) => (element as InspectorShell).view.passthrough)).toBe(
      false,
    );
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await page.locator('#target-a').click();
    expect(await page.locator('#clicks').textContent()).toBe('1');
    expect(await editor.count()).toBe(0);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.id = 'native-input';
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') input.dataset.escape = 'received';
      });
      document.body.append(input);
    });
    const input = page.locator('#native-input');
    await input.click();
    expect(await input.evaluate((element) => element === document.activeElement)).toBe(true);
    await input.fill('Host text');
    await input.press('Shift+ArrowLeft');
    expect(
      await input.evaluate(
        (element) =>
          (element as HTMLInputElement).selectionEnd! -
          (element as HTMLInputElement).selectionStart!,
      ),
    ).toBe(1);
    await input.press('Escape');
    expect(await input.getAttribute('data-escape')).toBe('received');
    await page.keyboard.down('Shift');
    await page.locator('#target-a').click();
    await page.keyboard.up('Shift');
    expect(await page.locator('#clicks').textContent()).toBe('2');
    expect(await editor.count()).toBe(0);
    expect((await read()).annotations).toHaveLength(1);
    // Inspector controls stay interactive while page selection is suspended.
    await controller.getByRole('button', { name: 'View annotation', exact: true }).click();
    await editor.getByRole('tab', { name: 'Styles', exact: true }).click();
    expect(await editor.textContent()).toContain('Style overrides on these targets are paused');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect((await current()).decision).toBeUndefined();
    await previewVariant(controller, 'broken');
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantPreview), {
        timeout: 6000,
      })
      .toMatchObject({ status: 'error', variantId: 'bold' });
    expect(await page.locator('[data-ainotation-variant="bold"]').count()).toBe(2);
    await controller.getByRole('button', { name: 'Previous design', exact: true }).click();
    await expect
      .poll(() => controller.locator('[data-current-variant]').getAttribute('data-current-variant'))
      .toBe('compact');
    await previewVariant(controller, 'bold');
    await expect
      .poll(() =>
        shell.evaluate((element) => (element as InspectorShell).view.variantPreview.status),
      )
      .toBe('ready');
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.syncing))
      .toBe(false);
    const initialPosition = (await controller.boundingBox())!;
    expect(initialPosition.x + initialPosition.width / 2).toBeCloseTo(640);
    expect(initialPosition.y + initialPosition.height).toBeCloseTo(884);
    const revisionBeforeMove = (await current()).revision;
    await page.mouse.move(initialPosition.x + 3, initialPosition.y + 3);
    await page.mouse.down();
    await page.mouse.move(initialPosition.x + 123, initialPosition.y - 147, { steps: 5 });
    await page.mouse.up();
    const movedPosition = (await controller.boundingBox())!;
    expect(movedPosition.x).toBeCloseTo(initialPosition.x + 120);
    expect(movedPosition.y).toBeCloseTo(initialPosition.y - 150);
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantPosition))
      .toEqual({ x: movedPosition.x, y: movedPosition.y });
    expect((await current()).revision).toBe(revisionBeforeMove);
    await controller.locator('summary').click();
    await controller.getByRole('textbox').fill('Keep this feedback while minimized.');
    await controller.getByRole('button', { name: 'Minimize panel', exact: true }).click();
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantMinimized))
      .toBe(true);
    expect(await controller.getByRole('button').count()).toBe(1);
    expect((await controller.boundingBox())!.height).toBeLessThanOrEqual(60);
    expect(
      await shell.evaluate((element) => (element as InspectorShell).view.variantsComparing),
    ).toBe(true);
    await controller.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/ui-variants-minimized.png'),
    });
    await page.locator('#target-a').click();
    expect(await page.locator('#clicks').textContent()).toBe('3');
    expect(await editor.count()).toBe(0);
    expect(await selectionOverlay.locator('.rect').count()).toBe(0);
    expect(await markers.locator('.marker:visible').count()).toBe(0);
    expect((await current()).decision).toBeUndefined();
    await controller.getByRole('button', { name: 'Expand panel', exact: true }).click();
    expect(await controller.getByRole('textbox').inputValue()).toBe(
      'Keep this feedback while minimized.',
    );
    expect(
      await controller.locator('[data-current-variant]').getAttribute('data-current-variant'),
    ).toBe('bold');
    expect((await controller.boundingBox())!.x).toBeCloseTo(movedPosition.x);
    expect((await controller.boundingBox())!.y).toBeCloseTo(movedPosition.y);
    await controller.locator('summary').click();
    await controller.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/ui-variants-native.png'),
    });
    await controller.getByRole('button', { name: 'I want this', exact: true }).click();
    await expect.poll(async () => (await current()).decision?.variantId).toBe('bold');
    expect(await controller.textContent()).toContain('Ask your agent to apply it');
    expect(await markers.locator('.marker:visible').count()).toBe(1);
    await page.locator('#target-a').hover();
    await expect.poll(() => selectionOverlay.locator('.hover').count()).toBe(1);
    await page.locator('#target-a').click();
    expect(await page.locator('#clicks').textContent()).toBe('3');
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Ordinary feedback after confirming.');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expect.poll(async () => (await read()).annotations.length).toBe(2);
    await page.reload();
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.connection), {
        timeout: 10000,
      })
      .toBe('connected');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(() => page.locator('[data-ainotation-variant="bold"]').count()).toBe(2);
    const restoredPosition = (await controller.boundingBox())!;
    expect(restoredPosition.x).toBeCloseTo(movedPosition.x);
    expect(restoredPosition.y).toBeCloseTo(movedPosition.y);
    await controller.locator('summary').click();
    await controller.getByRole('textbox').fill('Keep the structure; try softer spacing.');
    await controller.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect.poll(async () => (await current()).generation).toBe(2);
    expect((await current()).decision?.feedback).toBe('Keep the structure; try softer spacing.');
    expect(await markers.locator('.marker:visible').count()).toBe(2);
    expect(await page.locator('[data-ainotation-variant="bold"]').count()).toBe(2);
    await page.locator('#target-a').click({ position: { x: 12, y: 12 } });
    await editor.waitFor();
    expect(await page.locator('#clicks').textContent()).toBe('0');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    group.generations.push({ generation: 2, variants: ['fresh', 'quiet'] });
    await writeFile(join(root, 'variants.json'), JSON.stringify(group));
    await publish(['fresh', 'quiet']);
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantPreview), {
        timeout: 10000,
      })
      .toMatchObject({ status: 'ready', generation: 2 });
    await previewVariant(controller, 'fresh');
    await expect.poll(() => page.locator('[data-ainotation-variant="fresh"]').count()).toBe(2);
    await page.locator('#target-a').hover();
    await expect.poll(() => selectionOverlay.locator('.rect').count()).toBe(0);
    await page.locator('#target-a').click();
    expect(await page.locator('#clicks').textContent()).toBe('1');
    expect(await editor.count()).toBe(0);
    await controller.getByRole('button', { name: 'Cancel', exact: true }).click();
    const confirmation = markers.getByRole('alertdialog', { name: 'End this exploration?' });
    await confirmation.waitFor();
    expect((await current()).status).toBe('published');
    expect(await page.locator('[data-ainotation-variant="fresh"]').count()).toBe(2);
    expect(
      await confirmation
        .getByRole('button', { name: 'Keep comparing' })
        .evaluate((button) => button === (button.getRootNode() as ShadowRoot).activeElement),
    ).toBe(true);
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        '../../../output/playwright/ui-variants-cancel-confirmation.png',
      ),
    });
    await page.keyboard.press('Escape');
    await confirmation.waitFor({ state: 'hidden' });
    expect((await current()).status).toBe('published');
    await page.locator('#target-a').click();
    expect(await page.locator('#clicks').textContent()).toBe('2');
    await controller.getByRole('button', { name: 'Cancel', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Keep comparing' }).click();
    expect((await current()).status).toBe('published');
    await controller.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await current()).status).toBe('cancelled');
    await expect.poll(() => page.locator('#target-a').textContent()).toBe('Original action');
    await page.locator('#target-a').hover({ position: { x: 12, y: 12 } });
    await expect.poll(() => selectionOverlay.locator('.hover').count()).toBe(1);
    const decision = await current();
    await writeFile(join(root, 'variants.json'), 'null');
    await expect.poll(() => page.locator('[data-ainotation-exploration]').count()).toBe(0);
    await controller.getByRole('button', { name: 'View annotation', exact: true }).click();
    await editor.getByRole('tab', { name: 'Feedback', exact: true }).click();
    const variantsToggle = editor.getByRole('switch', { name: 'UI Variants', exact: true });
    expect(await variantsToggle.isDisabled()).toBe(true);
    await call('ainotation_complete_variants', {
      sessionId,
      annotationId: original.id,
      explorationId: decision.id,
      generation: decision.generation,
      revision: decision.revision,
      operationId: crypto.randomUUID(),
      decisionId: decision.decision!.id,
      summary: 'Restored originals and removed temporary registration.',
    });
    await controller.waitFor({ state: 'detached' });
    await expect.poll(() => variantsToggle.getAttribute('aria-checked')).toBe('false');
    expect(await variantsToggle.isDisabled()).toBe(false);
    expect((await read()).annotations[0]!.targets).toEqual(original.targets);

    // The old saved editor draft had variantsRequested=true. Completion must clear
    // that intent on reload as well as in the already-open editor.
    await page.reload();
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantsSupported))
      .toBe(true);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await editor.waitFor();
    expect(await variantsToggle.getAttribute('aria-checked')).toBe('false');
    expect(await variantsToggle.isDisabled()).toBe(false);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    expect((await current()).status).toBe('completed');
    expect(await controller.count()).toBe(0);
    const annotationIds = (await read()).annotations.map((annotation) => annotation.id);
    await markers.locator(`[data-annotation-id="${original.id}"]`).click();
    await variantsToggle.click();
    await editor
      .getByRole('textbox', { name: 'Feedback content', exact: true })
      .fill('Explore again after cleanup.');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expect.poll(async () => (await current()).status).toBe('requested');
    const restarted = await current();
    expect(restarted.id).not.toBe(decision.id);
    expect(restarted).toMatchObject({ generation: 1, revision: 1 });
    expect(restarted.decision).toBeUndefined();
    expect(restarted.completion).toBeUndefined();
    expect(restarted.manifest).toBeUndefined();
    expect((await read()).annotations.map((annotation) => annotation.id)).toEqual(annotationIds);
    expect((await read()).annotations[0]!.id).toBe(original.id);
    await controller.waitFor();
    expect(await controller.textContent()).toContain(
      'Waiting for your agent to generate candidates',
    );
    group.explorationId = restarted.id;
    group.generations = [{ generation: 1, variants: ['renewed'] }];
    await writeFile(join(root, 'variants.json'), JSON.stringify(group));
    await publish(['renewed']);
    await expect
      .poll(() =>
        shell.evaluate((element) => (element as InspectorShell).view.variantPreview.status),
      )
      .toBe('ready');
    await previewVariant(controller, 'renewed');
    await expect.poll(() => page.locator('[data-ainotation-variant="renewed"]').count()).toBe(2);
    // Deleting without any design decision must leave a discoverable cleanup task.
    await controller.getByRole('button', { name: 'View annotation', exact: true }).click();
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    await expect
      .poll(async () => (await read()).variantCleanups?.[0]?.variants.status)
      .toBe('cancelled');
    expect((await read()).annotations.some((annotation) => annotation.id === original.id)).toBe(
      false,
    );
    await expect.poll(() => page.locator('#target-a').textContent()).toBe('Original action');
    await expect.poll(() => controller.textContent()).toContain('Annotation deleted');
    expect(
      await controller.getByRole('button', { name: 'View annotation', exact: true }).count(),
    ).toBe(0);
    await page.reload();
    await expect
      .poll(() => shell.evaluate((element) => (element as InspectorShell).view.variantsSupported))
      .toBe(true);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(() => controller.textContent()).toContain('Cleanup is still pending');
    expect(await markers.locator(`[data-annotation-id="${original.id}"]`).count()).toBe(0);
    await page.locator('#target-a').click({ position: { x: 12, y: 12 } });
    await editor.getByRole('tab', { name: 'Feedback', exact: true }).click();
    expect(
      await editor.getByRole('switch', { name: 'UI Variants', exact: true }).isDisabled(),
    ).toBe(true);
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    const archived = await call('ainotation_get_variants', {
      sessionId,
      annotationId: original.id,
    });
    expect(archived.annotation.reason).toBe('annotation-deleted');
    expect(archived.annotation.variants.id).toBe(restarted.id);
    await page.screenshot({
      path: resolve(
        import.meta.dirname,
        '../../../output/playwright/ui-variants-deleted-cleanup.png',
      ),
    });
    await writeFile(join(root, 'variants.json'), 'null');
    await expect.poll(() => page.locator('[data-ainotation-exploration]').count()).toBe(0);
    const cleanup = archived.annotation.variants;
    await call('ainotation_complete_variants', {
      sessionId,
      annotationId: original.id,
      explorationId: cleanup.id,
      generation: cleanup.generation,
      revision: cleanup.revision,
      operationId: crypto.randomUUID(),
      decisionId: cleanup.decision.id,
      summary: 'Restored originals and removed temporary integration after annotation deletion.',
    });
    await controller.waitFor({ state: 'detached' });
    expect((await read()).variantCleanups![0]!.variants.status).toBe('completed');
    expect((await read()).annotations.some((annotation) => annotation.id === original.id)).toBe(
      false,
    );
    expect(errors).toEqual([]);

    await writeFile(join(root, 'variants.json'), JSON.stringify(group));
    await build({
      configFile: false,
      root,
      logLevel: 'silent',
      // Vitest sets NODE_ENV=test; explicitly exercise production branch elimination.
      define: { 'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true' },
      plugins: [ainotation({ name: 'variants-host', serviceDirectory: shared.directory })],
    });
    const assets = join(root, 'dist/assets');
    const code = (
      await Promise.all(
        (
          await readdir(assets)
        )
          .filter((name) => name.endsWith('.js'))
          .map((name) => readFile(join(assets, name), 'utf8')),
      )
    ).join('\n');
    expect(code).not.toContain('temporary-candidate');
    expect(code).not.toContain('ainotation.ui-variants.v1');
    production = await preview({
      configFile: false,
      root,
      logLevel: 'silent',
      preview: { host: '127.0.0.1', port: 0 },
    });
    const productionAddress = production.httpServer.address();
    if (!productionAddress || typeof productionAddress === 'string')
      throw new Error('Missing preview address');
    const published = await browser.newPage();
    await published.goto(`http://127.0.0.1:${productionAddress.port}/`);
    expect(await published.locator('#target-a').textContent()).toBe('Original action');
    expect(await published.locator('ainotation-inspector-shell').count()).toBe(0);
  } catch (cause) {
    const page = browser?.contexts()[0]?.pages()[0];
    const diagnostics = await page
      ?.evaluate(() => {
        const shell = document.querySelector('ainotation-inspector-shell') as InspectorShell | null;
        const registry = Reflect.get(globalThis, Symbol.for('ainotation.ui-variants.v1'));
        return {
          preview: shell?.view.variantPreview,
          variants: shell?.view.document?.annotations.map((annotation) => annotation.variants),
          host: [...document.querySelectorAll('[data-ainotation-slot]')].map(
            (node) => node.outerHTML,
          ),
          providers: registry
            ? [...registry.providers].map((provider: { options: unknown; snapshot: unknown }) => ({
                options: provider.options,
                snapshot: provider.snapshot,
              }))
            : [],
        };
      })
      .catch(() => null);
    throw new Error(
      `Variants integration failed: ${JSON.stringify({
        diagnostics,
        errors,
        consoleMessages,
        config: await readFile(join(root, 'variants.json'), 'utf8'),
        transformed: await web
          .transformRequest('/variants.json')
          .then((result) => result?.code)
          .catch((error: Error) => error.message),
      })}`,
      { cause },
    );
  } finally {
    await browser?.close();
    await client.close();
    await bridge.close();
    await web.close();
    if (production) await new Promise<void>((done) => production!.httpServer.close(() => done()));
    await shared.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);
