import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createServer, build } from 'vite-plus';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import { declareProject, initializeProject } from '@ainotation/mcp/project';
import { startSharedService, serviceOwnerPaths } from '@ainotation/mcp/service';
import { createProjectMcpServer } from '@ainotation/mcp/bridge';
import type { InspectorShell } from '@ainotation/sdk/ui';
import { createFeedbackDocument } from '@ainotation/schema';
import { ainotation } from './index';

it('restores deleted service files and images, then resolves a backup rollback through Settings', async () => {
  const { apps, shared } = await setup();
  const app = apps[0]!;
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  cleanup.push(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(10000);
  await page.goto(app.url);
  const shell = page.locator('ainotation-inspector-shell');
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection), { timeout: 15000 })
    .toBe('connected');
  await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
  await page.locator('#heading').click();
  const markers = page.locator('[data-ainotation-ui="markers"]');
  const text = markers.getByRole('textbox', { name: 'Feedback content', exact: true });
  await text.fill('Original recovery note');
  const png = await page.evaluate(() => {
    const canvas = window.document.createElement('canvas');
    canvas.width = canvas.height = 32;
    canvas.getContext('2d')!.fillRect(0, 0, 32, 32);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await markers.locator('input[type="file"]').setInputFiles({
    name: 'recovery.png',
    mimeType: 'image/png',
    buffer: Buffer.from(png, 'base64'),
  });
  await page
    .locator('[data-ainotation-ui="drawing"]')
    .getByRole('button', { name: 'Attach image', exact: true })
    .click();
  await markers.getByRole('button', { name: 'Add', exact: true }).click();
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.document?.annotations.length))
    .toBe(1);
  const document = await shell.evaluate((el) => (el as InspectorShell).view.document!);
  const image = document.annotations[0]!.images![0]!;
  const filePath = join(
    shared.directory,
    'projects',
    app.project.config.projectId,
    'feedback.json',
  );
  const imagePath = join(`${filePath}.images`, document.id, `${image.id}.png`);
  await expect
    .poll(() =>
      readFile(imagePath)
        .then((bytes) => bytes.toString('base64'))
        .catch(() => ''),
    )
    .toBe(png);
  await rm(shared.directory, { recursive: true });
  await expect
    .poll(
      () =>
        readFile(imagePath)
          .then((bytes) => bytes.toString('base64'))
          .catch(() => ''),
      { timeout: 10000 },
    )
    .toBe(png);
  expect(
    JSON.parse(await readFile(join(shared.directory, 'connection.json'), 'utf8')).instanceId,
  ).toBe(shared.connection.instanceId);
  await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).click();
  await text.fill('Latest browser version');
  await markers.getByRole('button', { name: 'Save', exact: true }).click();
  await expect
    .poll(() =>
      readFile(filePath, 'utf8').then(
        (body) => JSON.parse(body).sessions[0].document.annotations[0].comment,
      ),
    )
    .toBe('Latest browser version');
  await shared.close();
  await writeFile(filePath, '{interrupted');
  const restarted = await startSharedService({ directory: shared.directory });
  cleanup.push(restarted.close);
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.recoveryNeeded), {
      timeout: 20000,
    })
    .toBe(true);
  expect(
    await shell.evaluate((el) => (el as InspectorShell).view.document!.annotations[0]!.comment),
  ).toBe('Latest browser version');
  await shell.getByRole('button', { name: 'Settings', exact: true }).click();
  await shell.locator('details').nth(0).locator('summary').click();
  await shell.locator('details').nth(1).locator('summary').click();
  expect(await shell.locator('details').nth(0).textContent()).toContain('Latest browser version');
  expect(await shell.locator('details').nth(1).textContent()).toContain('Original recovery note');
  await shell.locator('#inspector-settings').screenshot({
    path: join(import.meta.dirname, '../../../output/playwright/recovery-settings.png'),
  });
  await shell.getByRole('button', { name: 'Use browser version', exact: true }).click();
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection), { timeout: 15000 })
    .toBe('connected');
  expect(await shell.evaluate((el) => (el as InspectorShell).view.recoveryNeeded)).toBe(false);
  expect(
    await shell
      .getByRole('button', { name: 'Export previous local version', exact: true })
      .isVisible(),
  ).toBe(true);
  expect(
    JSON.parse(await readFile(filePath, 'utf8')).sessions[0].document.annotations[0].comment,
  ).toBe('Latest browser version');
  expect(await readFile(imagePath)).toEqual(Buffer.from(png, 'base64'));
});

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(offline = false, legacy = false) {
  const root = await mkdtemp(join(tmpdir(), 'ainotation-vite-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const shared = await startSharedService({ directory: join(root, 'service') });
  cleanup.push(shared.close);
  const apps = [];
  for (const name of ['alpha', 'beta']) {
    const directory = join(root, name);
    await mkdir(directory);
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, type: 'module' }));
    await writeFile(
      join(directory, 'index.html'),
      `<html><head><title>${name}</title></head><body><h1 id="heading">${name} project</h1><button id="native">Native action</button><output id="result">Ready</output><script type="module">document.querySelector('#native').onclick = () => document.querySelector('#result').textContent = 'Activated';</script></body></html>`,
    );
    const project = legacy
      ? await initializeProject({ directory })
      : await declareProject(directory, { name });
    const base = name === 'beta' ? '/app/' : '/';
    const server = await createServer({
      configFile: false,
      root: directory,
      base,
      cacheDir: join(root, `cache-${name}`),
      plugins: [
        ainotation({
          ...(legacy ? {} : { name }),
          serviceDirectory: shared.directory,
          ...(offline ? { serviceCliPath: join(root, 'missing-cli.mjs') } : {}),
        }),
      ],
      server: { host: '127.0.0.1', port: 0, fs: { allow: [root, serviceOwnerPaths(root).root] } },
      logLevel: 'silent',
    });
    cleanup.push(() => server.close());
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    apps.push({
      server,
      project,
      directory,
      base,
      origin: `http://127.0.0.1:${address.port}`,
      url: `http://127.0.0.1:${address.port}${base}`,
    });
  }
  return { root, shared, apps };
}

it('automatically mounts and syncs two projects to their scoped MCP clients without exposing service credentials', async () => {
  const { apps, shared } = await setup();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  cleanup.push(() => browser.close());
  const savedIds: string[] = [];
  for (const app of apps) {
    expect(await readdir(app.directory)).not.toContain('ainotation.config.json');
    const context = await browser.newContext({
      locale: 'en-US',
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    page.setDefaultNavigationTimeout(20000);
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('__ainotation'))
        requests.push(`${new URL(response.url()).pathname}: ${response.status()}`);
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(app.url);
    const shell = page.locator('ainotation-inspector-shell');
    await shell.waitFor();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection), {
        timeout: 15000,
      })
      .toBe('connected')
      .catch((error) => {
        console.log({ requests, errors });
        throw error;
      });
    expect(await shell.count()).toBe(1);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    expect(await shell.locator('input[type="password"],input[type="url"]').count()).toBe(0);
    expect(await shell.getByRole('dialog', { name: 'Inspector settings' }).textContent()).toContain(
      app.project.config.name,
    );
    await page.keyboard.press('Escape');
    await page.locator('#heading').click({ position: { x: 30, y: 10 } });
    const editor = page.locator('[data-ainotation-ui="markers"]').getByRole('dialog');
    const input = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    await input.fill(`${app.project.config.name} feedback`);
    await editor.getByRole('tab', { name: 'Styles', exact: true }).click();
    await editor.getByRole('textbox', { name: 'Padding', exact: true }).fill('16px');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    const bridge = createProjectMcpServer({
      directory: app.directory,
      serviceDirectory: shared.directory,
    });
    cleanup.push(bridge.close);
    const client = new Client({ name: 'vite-plugin-test', version: '1' });
    cleanup.push(() => client.close());
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    const sessions = async () => {
      const result = await client.callTool({ name: 'ainotation_list_sessions', arguments: {} });
      expect(result.isError).not.toBe(true);
      return JSON.parse((result.content as { text: string }[])[0]!.text) as {
        id: string;
        annotations: {
          comment: string;
          targets: { styleChanges?: { property: string; value: string }[] }[];
        }[];
      }[];
    };
    await expect
      .poll(async () =>
        (await sessions()).flatMap((session) =>
          session.annotations.map((annotation) => annotation.comment),
        ),
      )
      .toEqual([`${app.project.config.name} feedback`]);
    const saved = await sessions();
    expect(saved[0]!.annotations[0]!.targets[0]!.styleChanges).toHaveLength(4);
    expect(
      saved[0]!.annotations[0]!.targets[0]!.styleChanges!.every(
        (change) => change.value === '16px',
      ),
    ).toBe(true);
    expect(requests.some((request) => request.endsWith('/api/health: 200'))).toBe(true);
    savedIds.push(saved[0]!.id);
    if (savedIds.length === 2)
      expect(
        (
          await client.callTool({
            name: 'ainotation_get_feedback',
            arguments: { sessionId: savedIds[0]! },
          })
        ).isError,
      ).toBe(true);
    expect(await page.content()).not.toContain(shared.connection.token);
    const injected = await page.request.get(`${app.url}@id/__x00__virtual:ainotation/client`);
    expect(await injected.text()).not.toContain(shared.connection.token);
    await page.reload();
    await shell.waitFor();
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection))
      .toBe('connected');
    expect(await shell.count()).toBe(1);
    expect(
      await shell.evaluate((el) => (el as InspectorShell).view.document!.annotations.length),
    ).toBe(1);
    expect(errors).toEqual([]);
  }
  await Promise.all(apps.map((app) => app.server.close()));
  const grantList = async () => {
    const response = await fetch(`${shared.connection.url}/control/grants`, {
      headers: { Authorization: `Bearer ${shared.connection.token}` },
    });
    return (await response.json()) as { grants: { kind: string }[] };
  };
  await vi.waitFor(async () =>
    expect((await grantList()).grants.filter((grant) => grant.kind === 'browser')).toHaveLength(0),
  );
});

it('registers project names at dev startup before a browser opens, with no identity file', async () => {
  const { apps, shared } = await setup();
  for (const app of apps) {
    expect(await readdir(app.directory)).not.toContain('ainotation.config.json');
    const bridge = createProjectMcpServer({
      directory: app.directory,
      serviceDirectory: shared.directory,
    });
    cleanup.push(bridge.close);
    const client = new Client({ name: 'startup-project-check', version: '1' });
    cleanup.push(() => client.close());
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await bridge.server.connect(st);
    await client.connect(ct);
    const result = await client.callTool({ name: 'ainotation_get_project', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({
      name: app.project.config.name,
      projectId: app.project.config.projectId,
    });
  }
});

it('rejects cross-origin bootstrap and limits browser proxy routes to sync and events', async () => {
  const { apps, shared } = await setup();
  const a = apps[0]!;
  const b = apps[1]!;
  const handshake = `${a.url}__ainotation/connect`;
  const protectedFile = await fetch(`${a.url}@fs/${shared.directory}/connection.json`);
  const coordinatorFile = await fetch(`${a.url}@fs/${serviceOwnerPaths(shared.directory).record}`);
  expect(coordinatorFile.status).toBe(403);
  const protectedBody = await protectedFile.text();
  expect(
    protectedFile.status,
    `content-type=${protectedFile.headers.get('content-type')}; exposes credential=${protectedBody.includes(shared.connection.token)}`,
  ).toBe(403);
  expect(
    (
      await fetch(handshake, {
        method: 'POST',
        headers: { Origin: b.origin, 'X-Ainotation-Client': '1' },
      })
    ).status,
  ).toBe(403);
  expect(
    (await fetch(handshake, { method: 'POST', headers: { 'X-Ainotation-Client': '1' } })).status,
  ).toBe(403);
  expect((await fetch(handshake, { method: 'POST', headers: { Origin: a.origin } })).status).toBe(
    403,
  );
  const response = await fetch(handshake, {
    method: 'POST',
    headers: { Origin: a.origin, 'X-Ainotation-Client': '1' },
  });
  expect(response.status).toBe(200);
  const bootstrap = (await response.json()) as {
    token: string;
    endpoint: string;
    projectId: string;
  };
  expect(bootstrap.projectId).toBe(a.project.config.projectId);
  const headers = { Origin: a.origin, Authorization: `Bearer ${bootstrap.token}` };
  expect((await fetch(`${bootstrap.endpoint}/control/projects`, { headers })).status).toBe(404);
  expect((await fetch(`${bootstrap.endpoint}/sessions`, { headers })).status).toBe(404);
  expect(
    (
      await fetch(`${bootstrap.endpoint}/sessions/${crypto.randomUUID()}/events`, {
        headers: { ...headers, Authorization: 'Bearer invalid' },
      })
    ).status,
  ).toBe(401);
  expect(
    (
      await fetch(`${b.url}__ainotation/api/sessions/${crypto.randomUUID()}/events`, {
        headers: { Origin: b.origin, Authorization: `Bearer ${bootstrap.token}` },
      })
    ).status,
  ).toBe(401);
});

it('does not inject Ainotation or start service code in production output', async () => {
  const { root, apps } = await setup();
  const app = apps[0]!;
  const output = join(root, 'production');
  await build({
    configFile: false,
    root: app.directory,
    plugins: [ainotation({ serviceDirectory: join(root, 'never-started') })],
    build: { outDir: output },
    logLevel: 'silent',
  });
  expect(await readFile(join(output, 'index.html'), 'utf8')).not.toContain('__ainotation');
  for (const file of await readdir(join(output, 'assets')))
    expect(await readFile(join(output, 'assets', file), 'utf8')).not.toContain(
      'ainotation-inspector-shell',
    );
  expect(await readdir(root)).not.toContain('never-started');
});

it('binds proxy credentials to the originating scheme even when an event request omits Origin', async () => {
  const { apps } = await setup();
  const app = apps[0]!;
  const secureOrigin = app.origin.replace('http:', 'https:');
  app.server.config.server.origin = secureOrigin;
  const bootstrap = async (origin: string) => {
    const response = await fetch(`${app.url}__ainotation/connect`, {
      method: 'POST',
      headers: { Origin: origin, 'X-Ainotation-Client': '1' },
    });
    expect(response.status).toBe(200);
    return (await response.json()) as { token: string };
  };
  const secure = await bootstrap(secureOrigin);
  const plain = await bootstrap(app.origin);
  expect(secure.token).not.toBe(plain.token);
  const document = createFeedbackDocument(`${secureOrigin}/`);
  const response = await fetch(`${app.url}__ainotation/api/sessions/${document.id}/sync`, {
    method: 'POST',
    headers: {
      Origin: secureOrigin,
      Authorization: `Bearer ${secure.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ document, operations: [] }),
  });
  expect(response.status).toBe(200);
  await response.body?.cancel();
  const path = `${app.url}__ainotation/api/sessions/${document.id}/events`;
  const wrong = await fetch(path, { headers: { Authorization: `Bearer ${plain.token}` } });
  expect(wrong.status).toBe(404);
  await wrong.body?.cancel();
  const stream = await fetch(path, {
    headers: { Authorization: `Bearer ${secure.token}` },
    signal: AbortSignal.timeout(3000),
  });
  expect(stream.status).toBe(200);
  await stream.body?.cancel();
});

it.each(['change', 'remove'] as const)(
  'closes the project bridge when its identity file is changed: %s',
  async (mode) => {
    const { apps, shared } = await setup(false, true);
    const app = apps[0]!;
    const connect = () =>
      fetch(`${app.url}__ainotation/connect`, {
        method: 'POST',
        headers: { Origin: app.origin, 'X-Ainotation-Client': '1' },
      });
    const initial = await connect();
    expect(initial.status).toBe(200);
    await initial.body?.cancel();
    // The watcher is initialized asynchronously after server startup. Mutate
    // only after the fixture is being watched, so unlink cannot precede add.
    await expect
      .poll(
        () =>
          app.server.watcher
            .getWatched()
            [dirname(app.project.configPath!)]?.includes(basename(app.project.configPath!)),
        { timeout: 3000 },
      )
      .toBe(true);
    if (mode === 'remove') await rm(app.project.configPath!);
    else
      await writeFile(
        app.project.configPath!,
        JSON.stringify({ ...app.project.config, projectId: crypto.randomUUID() }),
      );
    await expect
      .poll(async () => {
        const response = await connect();
        const status = response.status;
        await response.body?.cancel();
        return status;
      })
      .toBe(503);
    await expect
      .poll(async () => {
        const response = await fetch(`${shared.connection.url}/control/grants`, {
          headers: { Authorization: `Bearer ${shared.connection.token}` },
        });
        return ((await response.json()) as { grants: { kind: string }[] }).grants.filter(
          (grant) => grant.kind === 'browser',
        ).length;
      })
      .toBe(0);
  },
);

it('keeps local annotations usable while the shared service is unavailable', async () => {
  const { apps, shared } = await setup(true);
  await shared.close();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  cleanup.push(() => browser.close());
  const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(7000);
  await page.goto(apps[0]!.url);
  const shell = page.locator('ainotation-inspector-shell');
  await shell.waitFor();
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
    .toBe('ready');
  await expect
    .poll(() => shell.evaluate((el) => (el as InspectorShell).view.connection))
    .toBe('error');
  await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
  await page.locator('#heading').click({ position: { x: 20, y: 10 } });
  const editor = page.locator('[data-ainotation-ui="markers"]').getByRole('dialog');
  const input = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
  await input.fill('Keep this while offline');
  await input.press('Meta+Enter');
  await expect
    .poll(() =>
      shell.evaluate((el) =>
        (el as InspectorShell).view.document!.annotations.map((note) => note.comment),
      ),
    )
    .toEqual(['Keep this while offline']);
});
