import { resolve } from 'node:path';
import { createPlaygroundServer, configurePage } from './helpers';
import { expect, it } from 'vite-plus/test';
import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFeedbackStore, createMcpServer, startHttpServer } from '@ainotation/mcp';
import type { FeedbackExport } from '@ainotation/sdk';
import type { InspectorShell } from '@ainotation/sdk/ui';

it('persists and exports multiple annotations with MCP CRUD but no conversation surface', async () => {
  const web = await createPlaygroundServer(import.meta.url);
  let http: Awaited<ReturnType<typeof startHttpServer>> | undefined;
  let mcp: ReturnType<typeof createMcpServer> | undefined;
  let client: Client | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await web.listen();
    const address = web.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('No test server address');
    const origin = `http://127.0.0.1:${address.port}`;
    const store = await createFeedbackStore();
    const token = 'ainotation-integration-test-token';
    http = await startHttpServer({ store, token, origins: [origin], port: 0 });
    mcp = createMcpServer(store);
    client = new Client({ name: 'milestone-one-test', version: '0.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    await mcp.connect(serverTransport);
    await client.connect(clientTransport);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      permissions: ['clipboard-read', 'clipboard-write'],
    });
    const page = await context.newPage();
    const errors: string[] = [];
    configurePage(page, errors);
    await page.goto(origin);
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    const shell = page.locator('ainotation-inspector-shell');
    const markers = page.locator('[data-ainotation-ui="markers"]');
    const savedMarkers = markers.locator('[data-annotation-id]');
    const editor = markers.getByRole('dialog');
    const draft = editor.getByRole('textbox', { name: 'Feedback content', exact: true });
    const getDocument = () => shell.evaluate((el) => (el as InspectorShell).view.document);
    const comments = async () => (await getDocument())?.annotations.map((item) => item.comment);
    const exportJson = async () => {
      const event = page.waitForEvent('download');
      await shell.getByRole('button', { name: 'Export JSON', exact: true }).click();
      const download = await event;
      let contents = '';
      for await (const chunk of await download.createReadStream()) contents += chunk.toString();
      return JSON.parse(contents) as FeedbackExport;
    };
    const noConversationUI = async () => {
      for (const surface of [shell, markers]) {
        expect(await surface.locator('.replies, .reply-form, .reply-role, .status').count()).toBe(
          0,
        );
        expect(await surface.getByRole('button', { name: /Send reply|Reopen/ }).count()).toBe(0);
        expect(await surface.getByPlaceholder('Reply', { exact: true }).count()).toBe(0);
        expect(await surface.innerText()).not.toContain('Retained internal conversation');
      }
    };
    await expect
      .poll(() => shell.evaluate((el) => (el as InspectorShell).view.storage))
      .toBe('ready');
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    const firstComment = 'Align the sample heading with the preview text.';
    const secondComment = 'Use consistent spacing for these elements.';
    await page.keyboard.down('Shift');
    await page.locator('#sample-heading').click({ position: { x: 20, y: 10 } });
    expect(await editor.count()).toBe(0);
    await page.locator('#sample-output').click({ position: { x: 20, y: 15 } });
    expect(await editor.count()).toBe(0);
    await page.keyboard.up('Shift');
    await markers.getByRole('dialog', { name: 'New feedback', exact: true }).waitFor();
    await draft.fill(firstComment);
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(comments).toEqual([firstComment]);
    await editor.waitFor({ state: 'detached' });
    await page.locator('#sample-heading').click({ position: { x: 60, y: 10 } });
    await draft.fill(secondComment);
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(comments).toEqual([firstComment, secondComment]);
    await expect.poll(() => savedMarkers.count()).toBe(2);
    await editor.waitFor({ state: 'detached' });
    await noConversationUI();
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(secondComment);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(firstComment);
    expect(copied).toContain('#sample-heading');
    expect(copied).toContain('#sample-output');
    const initialExport = await exportJson();
    expect(initialExport.annotations).toHaveLength(2);
    expect(initialExport.annotations.map((annotation) => annotation.comment)).toEqual([
      firstComment,
      secondComment,
    ]);
    for (const annotation of initialExport.annotations) {
      expect(annotation).not.toHaveProperty('status');
      expect(annotation).not.toHaveProperty('replies');
    }
    await page.reload();
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await expect.poll(async () => (await getDocument())?.annotations.length).toBe(2);
    expect(await markers.isVisible()).toBe(false);
    expect(await page.locator('[data-ainotation-ui="selection"] .rect').count()).toBe(0);
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(() => savedMarkers.count()).toBe(2);
    expect(
      await markers.getByRole('button', { name: 'Edit annotation 1', exact: true }).isVisible(),
    ).toBe(true);
    await expect.poll(comments).toEqual([firstComment, secondComment]);
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await shell.getByRole('textbox', { name: 'Endpoint', exact: true }).fill(http.url);
    await shell.getByLabel('Token', { exact: true }).fill(token);
    await shell.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => store.list().length).toBe(1);
    const document = store.list()[0]!;
    const first = document.annotations[0]!;
    const second = document.annotations[1]!;
    expect(document.annotations.map((annotation) => annotation.id)).toEqual(
      initialExport.annotations.map((annotation) => annotation.id),
    );
    expect(first.targets).toHaveLength(2);
    expect(first.targets).toEqual(initialExport.annotations[0]!.targets);
    const pair = { sessionId: document.id, annotationId: first.id };
    const tools = (await client.listTools()).tools.map((tool) => tool.name);
    expect(tools).toContain('ainotation_create_annotation');
    expect(tools).not.toContain('ainotation_reply');
    expect(tools).not.toContain('ainotation_resolve');
    const read = await client.callTool({ name: 'ainotation_get_annotation', arguments: pair });
    expect(read.isError).not.toBe(true);
    expect(JSON.stringify(read.content)).toContain('#sample-heading');

    // Internal conversation support remains durable, but is not a phase-one interface.
    await store.action(document.id, first.id, {
      kind: 'resolve',
      summary: 'Retained internal conversation',
    });
    await expect.poll(async () => (await getDocument())?.annotations[0]?.replies.length).toBe(1);
    await noConversationUI();
    const patchedComment = 'Align the heading at narrow widths too.';
    expect(
      (
        await client.callTool({
          name: 'ainotation_update_annotation',
          arguments: { ...pair, patch: { comment: patchedComment } },
        })
      ).isError,
    ).not.toBe(true);
    await expect.poll(comments).toContain(patchedComment);
    const createdId = crypto.randomUUID();
    expect(
      (
        await client.callTool({
          name: 'ainotation_create_annotation',
          arguments: {
            sessionId: document.id,
            annotationId: createdId,
            comment: 'Check the preview contrast.',
            page: first.page,
            targets: first.targets,
          },
        })
      ).isError,
    ).not.toBe(true);
    await expect.poll(() => savedMarkers.count()).toBe(3);
    await expect.poll(comments).toContain('Check the preview contrast.');
    // MCP annotations without an anchor can share a fallback point; activate by keyboard.
    await markers.locator(`[data-annotation-id="${createdId}"]`).focus();
    await page.keyboard.press('Enter');
    await markers.getByRole('dialog', { name: 'Edit feedback', exact: true }).waitFor();
    await draft.fill('Keep this unsaved edit.');
    expect(
      (
        await client.callTool({
          name: 'ainotation_delete_annotation',
          arguments: { sessionId: document.id, annotationId: createdId },
        })
      ).isError,
    ).not.toBe(true);
    await expect.poll(() => savedMarkers.count()).toBe(2);
    await editor.waitFor({ state: 'detached' });
    expect(await markers.getByRole('button', { name: 'New annotation', exact: true }).count()).toBe(
      0,
    );
    expect(await shell.evaluate((el) => (el as InspectorShell).view.draft)).toBe(
      'Keep this unsaved edit.',
    );
    expect(await shell.evaluate((el) => (el as InspectorShell).view.editingId)).toBeNull();
    expect(await shell.evaluate((el) => (el as InspectorShell).view.message)).toContain(
      'Unsaved text is kept',
    );
    expect((await getDocument())?.annotations).toHaveLength(2);
    await page.locator('#sample-heading').click({ position: { x: 120, y: 10 } });
    expect(await draft.inputValue()).toBe('Keep this unsaved edit.');
    await editor.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(store.get(document.id).annotations[0]?.replies[0]?.message).toBe(
      'Retained internal conversation',
    );
    expect(store.get(document.id).annotations[0]?.status).toBe('resolved');

    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await shell.getByRole('button', { name: 'Disconnect', exact: true }).click();
    await markers.locator(`[data-annotation-id="${second.id}"]`).click();
    const offlineEdit = 'Keep spacing consistent at narrow widths.';
    await draft.fill(offlineEdit);
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(comments).toContain(offlineEdit);
    await editor.waitFor({ state: 'detached' });
    await page.locator('#sample-heading').click({ position: { x: 120, y: 10 } });
    await draft.fill('An offline annotation to delete.');
    await editor.getByRole('button', { name: 'Add', exact: true }).click();
    await expect.poll(comments).toContain('An offline annotation to delete.');
    await editor.waitFor({ state: 'detached' });
    await markers.getByRole('button', { name: 'Edit annotation 3', exact: true }).click();
    await editor.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect.poll(comments).toEqual([patchedComment, offlineEdit]);
    await editor.waitFor({ state: 'detached' });
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    await shell.getByLabel('Token', { exact: true }).fill(token);
    await shell.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect.poll(() => store.get(document.id).annotations[1]?.comment).toBe(offlineEdit);
    await page.reload();
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(comments).toEqual([patchedComment, offlineEdit]);
    await noConversationUI();
    await shell.getByRole('button', { name: 'Copy feedback', exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toContain(offlineEdit);
    const copiedAgain = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedAgain).toContain(patchedComment);
    expect(copiedAgain).not.toContain('Retained internal conversation');
    expect(copiedAgain).not.toContain('resolved');
    const exported = await exportJson();
    expect(exported.annotations.map((annotation) => annotation.id)).toEqual([first.id, second.id]);
    for (const annotation of exported.annotations) {
      expect(annotation).not.toHaveProperty('replies');
      expect(annotation).not.toHaveProperty('status');
    }
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-one-desktop.png'),
      scale: 'css',
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        shell.evaluate(
          (element) =>
            element.getBoundingClientRect().right <= innerWidth &&
            window.document.documentElement.scrollWidth <= innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: resolve(import.meta.dirname, '../../../output/playwright/milestone-one-mobile.png'),
      scale: 'css',
    });
    await shell.getByRole('button', { name: 'Settings', exact: true }).click();
    const settings = shell.getByRole('dialog', { name: 'Inspector settings', exact: true });
    const settingsBox = await settings.boundingBox();
    expect(settingsBox!.x).toBeGreaterThanOrEqual(0);
    expect(settingsBox!.x + settingsBox!.width).toBeLessThanOrEqual(390);
    expect(settingsBox!.y + settingsBox!.height).toBeLessThan((await shell.boundingBox())!.y);
    await page.keyboard.press('Escape');
    expect(await settings.isVisible()).toBe(false);
    expect(await shell.evaluate((el) => (el as InspectorShell).view.picking)).toBe(true);
    await shell.getByRole('button', { name: 'Clear all annotations', exact: true }).click();
    await expect.poll(comments).toEqual([]);
    await expect.poll(() => store.get(document.id).annotations).toEqual([]);
    await expect.poll(() => savedMarkers.count()).toBe(0);
    await page.reload();
    await page.getByRole('button', { name: 'Mount inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).click();
    await expect.poll(comments).toEqual([]);
    expect((await exportJson()).annotations).toEqual([]);
    await shell.getByRole('button', { name: 'Close inspector', exact: true }).click();
    await shell.getByRole('button', { name: 'Open inspector', exact: true }).waitFor();
    expect(await shell.count()).toBe(1);
    await page.getByRole('button', { name: 'Unmount inspector', exact: true }).click();
    await expect.poll(() => page.locator('[data-ainotation-ui]').count()).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([
      browser?.close(),
      client?.close(),
      mcp?.close(),
      http?.close(),
      web.close(),
    ]);
  }
});
