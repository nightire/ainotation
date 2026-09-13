import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer, type PluginOption, type ViteDevServer } from 'vite-plus';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startSharedService } from '@ainotation/mcp/service';
import { createProjectMcpServer } from '@ainotation/mcp/bridge';
import { ainotation } from '@ainotation/vite';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { configurePage } from './helpers';

it('runs real React and Vue apps with automatic SDK injection and separate MCP feedback', async () => {
  const workspace = resolve(import.meta.dirname, '../../..');
  const temporary = await mkdtemp(join(tmpdir(), 'ainotation-framework-apps-'));
  const servers: ViteDevServer[] = [];
  let shared: Awaited<ReturnType<typeof startSharedService>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let bridge: ReturnType<typeof createProjectMcpServer> | undefined;
  let client: Client | undefined;
  try {
    shared = await startSharedService({ directory: join(temporary, 'service') });
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    bridge = createProjectMcpServer({ cwd: workspace, serviceDirectory: shared.directory });
    client = new Client({ name: 'framework-workspace-test', version: '1' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    const pageErrors: string[] = [];
    const documents: string[] = [];
    for (const name of ['react', 'vue']) {
      const root = join(workspace, 'apps', name);
      const require = createRequire(join(root, 'package.json'));
      const framework: { default: () => PluginOption } = await import(
        pathToFileURL(require.resolve(`@vitejs/plugin-${name}`)).href
      );
      const server = await createServer({
        configFile: false,
        root,
        cacheDir: join(temporary, `cache-${name}`),
        logLevel: 'silent',
        server: { host: '127.0.0.1', port: 0 },
        plugins: [framework.default(), ainotation({ name, serviceDirectory: shared.directory })],
      });
      servers.push(server);
      await server.listen();
      const address = server.httpServer!.address();
      if (!address || typeof address === 'string') throw new Error('Missing server address');
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      configurePage(page, pageErrors);
      await page.goto(`http://127.0.0.1:${address.port}/`);
      const shell = page.locator('ainotation-inspector-shell');
      await shell.waitFor();
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection), {
          timeout: 10000,
        })
        .toBe('connected');
      expect(await shell.count()).toBe(1);
      await page.locator('#increment').click();
      expect(await page.locator('#sample-count').textContent()).toBe('1');
      await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
      await page.keyboard.down('Alt');
      await page.locator('#increment').click();
      await page.locator('#display-name').fill('Casey');
      await page.locator('#plan').selectOption('Solo');
      await page.locator('#details-trigger').click();
      await page.keyboard.up('Alt');
      expect(await page.locator('#sample-count').textContent()).toBe('2');
      expect(await page.locator('#profile-preview').textContent()).toContain('Casey');
      expect(await page.locator('#profile-preview').textContent()).toContain('solo');
      expect(await page.locator('#sample-details').isVisible()).toBe(true);
      await page.locator('#sample-heading').click({ position: { x: 40, y: 10 } });
      const input = page
        .locator('[data-ainotation-ui="markers"]')
        .getByRole('textbox', { name: 'Feedback content', exact: true });
      await input.fill(`${name} framework feedback`);
      await input.press('Meta+Enter');
      const sessions = async () => {
        const result = await client!.callTool({
          name: 'ainotation_list_sessions',
          arguments: { project: name },
        });
        expect(result.isError).not.toBe(true);
        return JSON.parse((result.content as { text: string }[])[0]!.text) as {
          id: string;
          annotations: { comment: string }[];
        }[];
      };
      await expect
        .poll(async () =>
          (await sessions()).flatMap((document) =>
            document.annotations.map((note) => note.comment),
          ),
        )
        .toEqual([`${name} framework feedback`]);
      documents.push((await sessions())[0]!.id);
      await page.reload();
      await shell.waitFor();
      await expect
        .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection))
        .toBe('connected');
      expect(await shell.count()).toBe(1);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(await page.locator('html').evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
    }
    const projects = await client.callTool({ name: 'ainotation_list_projects', arguments: {} });
    expect(
      JSON.parse((projects.content as { text: string }[])[0]!.text).projects.map(
        (project: { name: string }) => project.name,
      ),
    ).toEqual(['react', 'vue']);
    expect(
      (
        await client.callTool({
          name: 'ainotation_get_feedback',
          arguments: { project: 'react', sessionId: documents[1]! },
        })
      ).isError,
    ).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await Promise.all([client?.close(), bridge?.close(), browser?.close()]);
    await Promise.all(servers.map((server) => server.close()));
    await shared?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
