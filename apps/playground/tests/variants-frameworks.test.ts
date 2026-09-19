import { createRequire } from 'node:module';
import { mkdtemp, mkdir, realpath, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type PluginOption } from 'vite-plus';
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
import { reactVariants, vueVariants } from './variant-framework-fixtures';

it.each(['react', 'vue'] as const)(
  'switches and finalizes structural variants in a real %s host',
  async (framework) => {
    const workspace = resolve(import.meta.dirname, '../../..');
    const directory = await realpath(
      await mkdtemp(join(tmpdir(), `ainotation-variants-${framework}-`)),
    );
    const root = join(directory, 'app');
    await mkdir(root);
    await symlink(
      join(workspace, 'apps', framework, 'node_modules'),
      join(root, 'node_modules'),
      'dir',
    );
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ name: `variants-${framework}`, type: 'module', private: true }),
    );
    const entry = framework === 'react' ? 'main.tsx' : 'main.js';
    const source = framework === 'react' ? 'main.tsx' : 'App.vue';
    await writeFile(
      join(root, 'index.html'),
      `<!doctype html><html lang="en"><head><title>${framework} variants</title><style>body{font:16px system-ui;padding:48px}button{padding:12px 24px}section{padding:20px;background:#e8f1ed}</style></head><body><div id="root"></div><script type="module" src="/${entry}"></script></body></html>`,
    );
    await writeFile(join(root, 'variants.json'), 'null');
    await writeFile(join(root, source), framework === 'react' ? reactVariants : vueVariants);
    if (framework === 'vue')
      await writeFile(
        join(root, entry),
        "import { createApp } from 'vue'; import App from './App.vue'; const app = createApp(App); app.mount('#root'); if(import.meta.hot) import.meta.hot.dispose(() => app.unmount());",
      );
    const require = createRequire(join(workspace, 'apps', framework, 'package.json'));
    const plugin: { default: () => PluginOption } = await import(
      pathToFileURL(require.resolve(`@vitejs/plugin-${framework}`)).href
    );
    const shared = await startSharedService({ directory: join(directory, 'service') });
    const web = await createServer({
      configFile: false,
      root,
      cacheDir: join(directory, 'cache'),
      logLevel: 'silent',
      plugins: [
        plugin.default(),
        ainotation({ name: `variants-${framework}`, serviceDirectory: shared.directory }),
      ],
      server: { host: '127.0.0.1', port: 0, fs: { allow: [directory, workspace] } },
    });
    const bridge = createProjectMcpServer({ directory: root, serviceDirectory: shared.directory });
    const client = new Client({ name: 'framework-variant-agent', version: '1' });
    let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
    try {
      const [ct, st] = InMemoryTransport.createLinkedPair();
      await bridge.server.connect(st);
      await client.connect(ct);
      await web.listen();
      const address = web.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing address');
      browser = await chromium.launch({ channel: 'chrome', headless: true });
      const page = await browser.newPage({
        locale: 'en-US',
        viewport: { width: 1280, height: 900 },
      });
      const errors: string[] = [];
      configurePage(page, errors);
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const shell = page.locator('ainotation-inspector-shell');
      await expect
        .poll(() => shell.evaluate((element) => (element as InspectorShell).view.connection), {
          timeout: 15000,
        })
        .toBe('connected');
      await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
      await page.keyboard.down('Shift');
      await page.locator('#target-a').click();
      await page.locator('#target-b').click();
      await page.keyboard.up('Shift');
      const markers = page.locator('[data-ainotation-ui="markers"]');
      await markers.getByRole('switch', { name: 'UI Variants', exact: true }).click();
      await markers.getByRole('button', { name: 'Add', exact: true }).click();
      await markers.getByRole('dialog').waitFor({ state: 'detached' });
      const sessionId = await shell.evaluate(
        (element) => (element as InspectorShell).view.document!.id,
      );
      const call = async (name: string, args: Record<string, unknown>) => {
        const response = await client.callTool({ name, arguments: args });
        expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
        return JSON.parse((response.content as { text: string }[])[0]!.text);
      };
      const read = async () =>
        FeedbackExportSchema.parse(await call('ainotation_get_feedback', { sessionId }))
          .annotations[0]!;
      await expect.poll(async () => (await read())?.variants?.status).toBe('requested');
      const annotation = await read();
      const exploration = annotation.variants!;
      await writeFile(
        join(root, 'variants.json'),
        JSON.stringify({
          explorationId: exploration.id,
          targetIds: exploration.targetIds,
          generations: [{ generation: 1, variants: ['compact'] }],
        }),
      );
      await call('ainotation_publish_variants', {
        sessionId,
        annotationId: annotation.id,
        explorationId: exploration.id,
        generation: 1,
        revision: exploration.revision,
        operationId: crypto.randomUUID(),
        choices: [{ id: 'compact', label: 'Compact' }],
      });
      await expect
        .poll(
          () => shell.evaluate((element) => (element as InspectorShell).view.variantPreview.status),
          { timeout: 15000 },
        )
        .toBe('ready');
      // React Fast Refresh may fall back to a full reload; the inspector restores collapsed.
      const launcher = shell.getByRole('button', { name: 'Open inspector', exact: true });
      if (await launcher.isVisible()) await launcher.click();
      const controls = markers.getByRole('region', { name: 'UI Variants', exact: true });
      await previewVariant(controls, 'compact');
      await expect.poll(() => page.locator('[data-ainotation-variant="compact"]').count()).toBe(2);
      expect(await page.locator('section#target-b').count()).toBe(1);
      await page.locator('#target-a').click();
      expect(await page.locator('#count').textContent()).toBe('1');
      expect(await markers.getByRole('dialog').count()).toBe(0);
      await previewVariant(controls, 'original');
      await expect.poll(() => page.locator('p#target-b').count()).toBe(1);
      expect(await page.locator('#count').textContent()).toBe('1');
      await previewVariant(controls, 'compact');
      await expect
        .poll(() =>
          shell.evaluate((element) => (element as InspectorShell).view.variantPreview.status),
        )
        .toBe('ready');
      await controls.getByRole('button', { name: 'I want this', exact: true }).click();
      await expect.poll(async () => (await read()).variants?.status).toBe('accepted');
      const selected = (await read()).variants!;
      const final =
        framework === 'react'
          ? `import React from 'react'; import { createRoot } from 'react-dom/client'; const root=createRoot(document.querySelector('#root')); root.render(<main><button id="target-a"><strong>Compact</strong> →</button><section id="target-b">Compact help</section></main>); if(import.meta.hot) { import.meta.hot.accept(); import.meta.hot.dispose(() => root.unmount()); }`
          : '<template><main><button id="target-a"><strong>Compact</strong> →</button><section id="target-b">Compact help</section></main></template>';
      await writeFile(join(root, source), final);
      await expect
        .poll(() => page.locator('[data-ainotation-exploration]').count(), { timeout: 10000 })
        .toBe(0);
      await call('ainotation_complete_variants', {
        sessionId,
        annotationId: annotation.id,
        explorationId: selected.id,
        generation: selected.generation,
        revision: selected.revision,
        operationId: crypto.randomUUID(),
        decisionId: selected.decision!.id,
        summary: 'Applied Compact and removed exploration source.',
      });
      await controls.waitFor({ state: 'detached' });
      expect(await page.locator('#target-a').textContent()).toContain('Compact');
      expect((await read()).targets).toEqual(annotation.targets);
      expect(errors).toEqual([]);
    } finally {
      await browser?.close();
      await client.close();
      await bridge.close();
      await web.close();
      await shared.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
  60000,
);
