import { openDB, type IDBPDatabase } from 'idb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { createAinotation, type Ainotation } from './index';
import type { DraftRecord } from './core/storage';
import type { InspectorAction } from './core/types';
import type { InspectorShell } from './ui';

const instances: Ainotation[] = [];
const fixtures: HTMLElement[] = [];
const databases: { db: IDBPDatabase; pageKeys: string[] }[] = [];

beforeEach(() => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
});

function action(shell: InspectorShell, detail: InspectorAction) {
  shell.dispatchEvent(
    new CustomEvent<InspectorAction>('ainotation-action', {
      detail,
      bubbles: true,
      composed: true,
    }),
  );
}

function overlay(kind: 'selection' | 'markers') {
  return document.querySelector<HTMLElement>(`[data-ainotation-ui="${kind}"]`)!;
}

function select(button: HTMLButtonElement, shiftKey = false) {
  const rect = button.getBoundingClientRect();
  button.dispatchEvent(
    new MouseEvent('click', {
      clientX: Math.round(rect.x + rect.width / 2),
      clientY: Math.round(rect.y + rect.height / 2),
      shiftKey,
      bubbles: true,
      composed: true,
      cancelable: true,
    }),
  );
}

async function selectMultiple(shell: InspectorShell, buttons: HTMLButtonElement[]) {
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
  );
  try {
    for (const button of buttons) select(button, true);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(false);
    expect(shell.view.marker).toBeNull();
  } finally {
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
  }
  await vi.waitFor(() => {
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.selected).toHaveLength(buttons.length);
  });
}

async function setup(options: Parameters<typeof createAinotation>[0] = {}) {
  const projectId = options.projectId ?? crypto.randomUUID();
  const instance = createAinotation({ ...options, projectId });
  instances.push(instance);
  const fixture = document.createElement('div');
  fixture.id = `fixture-${projectId}`;
  const buttons = ['First target', 'Second target'].map((text, index) => {
    const button = document.createElement('button');
    button.id = `target-${projectId}-${index}`;
    button.textContent = text;
    fixture.append(button);
    return button;
  });
  document.body.append(fixture);
  fixtures.push(fixture);
  await instance.mount();
  const shell = document.querySelector('ainotation-inspector-shell')!;
  await vi.waitFor(() => {
    expect(shell.view.storage).toBe('ready');
    expect(shell.expanded).toBe(false);
    expect(shell.view.picking).toBe(false);
    expect(shell.view.editorOpen).toBe(false);
    expect(getComputedStyle(overlay('markers')).display).toBe('none');
  });
  await shell.updateComplete;
  shell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
  await vi.waitFor(() => {
    expect(shell.expanded).toBe(true);
    expect(shell.view.picking).toBe(true);
    expect(getComputedStyle(overlay('markers')).display).toBe('block');
  });
  const db = await openDB('ainotation-feedback', 1);
  const originalUrl = location.href;
  const pageKeys = [JSON.stringify([projectId, originalUrl])];
  databases.push({ db, pageKeys });
  const read = (url = originalUrl): Promise<DraftRecord | undefined> =>
    db.get('pages', JSON.stringify([projectId, url]));
  return { instance, fixture, buttons, shell, read, projectId, pageKeys };
}

async function save(shell: InspectorShell, comment: string) {
  action(shell, { type: 'draft', value: comment });
  action(shell, { type: 'save' });
  await vi.waitFor(() => {
    expect(shell.view.document?.annotations.some((note) => note.comment === comment)).toBe(true);
    expect(shell.view).toMatchObject({
      selected: [],
      draft: '',
      editingId: null,
      editorOpen: false,
      marker: null,
      saving: false,
      picking: true,
    });
    expect(shell.view.message).toBe('Feedback saved');
    expect(
      overlay('markers').shadowRoot!.querySelector('[aria-label="New annotation"]'),
    ).toBeNull();
    expect(overlay('markers').shadowRoot!.querySelector('[role="dialog"]')).toBeNull();
  });
}

afterEach(async () => {
  for (const instance of instances.splice(0)) instance.destroy();
  for (const fixture of fixtures.splice(0)) fixture.remove();
  vi.restoreAllMocks();
  for (const { db, pageKeys } of databases.splice(0)) {
    try {
      for (const key of pageKeys) await db.delete('pages', key);
    } finally {
      db.close();
    }
  }
});

describe('mounted feedback runtime', () => {
  it('recovers saved project pages without navigating to each page', async () => {
    const { shell, buttons, read, projectId, pageKeys } = await setup();
    select(buttons[0]!);
    await save(shell, 'Current page');
    const first = (await read())!;
    const otherUrl = `${location.origin}/other-recovery-page`;
    const otherKey = JSON.stringify([projectId, otherUrl]);
    pageKeys.push(otherKey);
    await databases.at(-1)!.db.put(
      'pages',
      {
        ...first,
        document: {
          ...first.document,
          id: crypto.randomUUID(),
          url: otherUrl,
          annotations: first.document.annotations.map((annotation) => ({
            ...annotation,
            id: crypto.randomUUID(),
            comment: 'Other saved page',
            page: { ...annotation.page, url: otherUrl },
          })),
        },
        operations: [],
      },
      otherKey,
    );
    const posted: string[] = [];
    const epoch = crypto.randomUUID();
    vi.spyOn(window, 'fetch').mockImplementation(async (_url, init) => {
      if (init?.method === 'POST') {
        const request = JSON.parse(init.body as string) as {
          document: import('@ainotation/schema').FeedbackDocument;
          operations: { id: string }[];
        };
        posted.push(request.document.url);
        return Response.json({
          document: request.document,
          acknowledged: request.operations.map((operation) => operation.id),
          storageEpoch: epoch,
          missingImages: [],
        });
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            init?.signal?.addEventListener('abort', () => controller.error(new Error('Stopped')), {
              once: true,
            });
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    });
    action(shell, {
      type: 'connect',
      endpoint: 'http://127.0.0.1:4748',
      token: 'recovery-test-token',
    });
    await vi.waitFor(() => expect(shell.view.connection).toBe('connected'));
    action(shell, { type: 'recover-project' });
    await vi.waitFor(() => {
      expect(shell.view.recoveringProject).toBe(false);
      expect(shell.view.message).toBe('Checked 2 of 2 saved pages.');
    });
    expect(posted).toContain(otherUrl);
    expect(shell.view.recoveryPages).toEqual([]);
    expect(location.href).toBe(first.document.url);
    const beforeCancellation = await read();
    let transferSignal: AbortSignal | undefined;
    vi.spyOn(window, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          transferSignal = init?.signal ?? undefined;
          transferSignal?.addEventListener(
            'abort',
            () => reject(new DOMException('Cancelled', 'AbortError')),
            { once: true },
          );
        }),
    );
    action(shell, { type: 'recover-project' });
    await vi.waitFor(() => expect(transferSignal).toBeDefined());
    action(shell, { type: 'disconnect' });
    await vi.waitFor(() => expect(shell.view.recoveringProject).toBe(false));
    expect(transferSignal?.aborted).toBe(true);
    expect(await read()).toEqual(beforeCancellation);
  });

  it('keeps local-only feedback and images usable without restoring or changing MCP credentials', async () => {
    const projectId = crypto.randomUUID();
    const credentialsKey = `ainotation:mcp:${projectId}`;
    const credentials = { endpoint: 'http://127.0.0.1:4748', token: 'saved-test-token' };
    const storedCredentials = JSON.stringify(credentials);
    sessionStorage.setItem(credentialsKey, storedCredentials);
    const originalUrl = location.href;
    const originalGet = sessionStorage.getItem.bind(sessionStorage);
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const removeItem = vi.spyOn(Storage.prototype, 'removeItem');
    const fetch = vi
      .spyOn(window, 'fetch')
      .mockImplementation(async () => new Response(null, { status: 503 }));
    const clipboard = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue();
    const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createUrl = vi.spyOn(URL, 'createObjectURL');
    try {
      const { instance, shell, buttons, read, pageKeys } = await setup({ projectId, mcp: false });
      expect(shell.view).toMatchObject({
        localOnly: true,
        managedConnection: false,
        endpoint: '',
        connection: 'offline',
        syncing: false,
      });
      action(shell, { type: 'connect', ...credentials });
      action(shell, { type: 'disconnect' });
      select(buttons[0]!);
      await save(shell, 'Local feedback');
      const annotation = instance.getDocument()!.annotations[0]!;
      action(shell, { type: 'edit', id: annotation.id });
      await save(shell, 'Updated local feedback');
      expect(await instance.copyFeedback()).toContain('Updated local feedback');
      expect(clipboard).toHaveBeenCalledOnce();
      action(shell, { type: 'export' });
      await vi.waitFor(() => expect(download).toHaveBeenCalledOnce());
      const json = createUrl.mock.calls.at(-1)![0] as Blob;
      expect(await json.text()).toContain('Updated local feedback');

      // Exercise a real image attachment, then the ZIP export, with MCP disabled.
      action(shell, { type: 'edit', id: annotation.id });
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
      const png = await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob!)));
      action(shell, {
        type: 'import-image',
        file: new File([png], 'local.png', { type: 'image/png' }),
      });
      await vi.waitFor(() => {
        const attach = document
          .querySelector('[data-ainotation-ui="drawing"]')
          ?.shadowRoot?.querySelector<HTMLButtonElement>('[aria-label="Attach image"]');
        expect(attach).toBeTruthy();
      });
      document
        .querySelector('[data-ainotation-ui="drawing"]')!
        .shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Attach image"]')!
        .click();
      await vi.waitFor(() => expect(shell.view.images).toHaveLength(1));
      await save(shell, 'Local feedback with an image');
      const image = instance.getDocument()!.annotations[0]!.images![0]!;
      expect((await read())?.images?.[image.id]).toBeInstanceOf(Blob);
      action(shell, { type: 'export' });
      await vi.waitFor(() => expect(download).toHaveBeenCalledTimes(2));
      const zip = createUrl.mock.calls.at(-1)![0] as Blob;
      expect(new Uint8Array(await zip.slice(0, 2).arrayBuffer())).toEqual(new Uint8Array([80, 75]));

      const saved = instance.getDocument();
      const nextUrl = new URL(originalUrl);
      nextUrl.hash = `local-${projectId}`;
      pageKeys.push(JSON.stringify([projectId, nextUrl.href]));
      history.replaceState(null, '', nextUrl.href);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(shell.view.document?.url).toBe(nextUrl.href));
      history.replaceState(null, '', originalUrl);
      window.dispatchEvent(new PopStateEvent('popstate'));
      await vi.waitFor(() => expect(instance.getDocument()).toEqual(saved));
      instance.destroy();
      await instance.mount();
      const restored = document.querySelector('ainotation-inspector-shell')!;
      expect(instance.getDocument()).toEqual(saved);
      expect(restored.view).toMatchObject({
        localOnly: true,
        connection: 'offline',
        syncing: false,
      });
      action(restored, {
        type: 'connect',
        endpoint: 'http://127.0.0.1:4749',
        token: 'new-test-token',
      });
      action(restored, { type: 'delete', id: annotation.id });
      await vi.waitFor(async () => expect((await read())?.document.annotations).toEqual([]));
      expect(fetch).not.toHaveBeenCalled();
      expect(getItem).not.toHaveBeenCalledWith(credentialsKey);
      expect(setItem.mock.calls.some(([key]) => key === credentialsKey)).toBe(false);
      expect(removeItem).not.toHaveBeenCalledWith(credentialsKey);
      expect(originalGet(credentialsKey)).toBe(storedCredentials);
    } finally {
      history.replaceState(null, '', originalUrl);
      sessionStorage.removeItem(credentialsKey);
    }
  });

  it('ignores malformed saved MCP credentials in local-only mode', async () => {
    const projectId = crypto.randomUUID();
    const key = `ainotation:mcp:${projectId}`;
    sessionStorage.setItem(key, '{invalid');
    try {
      const { shell } = await setup({ projectId, mcp: false });
      expect(shell.view.localOnly).toBe(true);
      expect(shell.view.message).toBe('');
      expect(sessionStorage.getItem(key)).toBe('{invalid');
    } finally {
      sessionStorage.removeItem(key);
    }
  });

  it.each(['saved', 'explicit'] as const)(
    'retains %s manual MCP connections when local-only mode is not enabled',
    async (source) => {
      const projectId = crypto.randomUUID();
      const key = `ainotation:mcp:${projectId}`;
      const saved = { endpoint: 'http://127.0.0.1:4748', token: 'saved-test-token' };
      const explicit = { endpoint: 'http://127.0.0.1:4749', token: 'explicit-test-token' };
      sessionStorage.setItem(key, JSON.stringify(saved));
      const fetch = vi
        .spyOn(window, 'fetch')
        .mockImplementation(async () => new Response(null, { status: 503 }));
      try {
        const { shell } = await setup({
          projectId,
          ...(source === 'explicit' ? { mcp: explicit } : {}),
        });
        const connection = source === 'explicit' ? explicit : saved;
        await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(shell.view.localOnly).toBe(false);
        expect(shell.view.endpoint).toBe(connection.endpoint);
        expect(
          fetch.mock.calls.some(
            ([url, init]) =>
              (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).startsWith(
                `${connection.endpoint}/sessions/`,
              ) && new Headers(init?.headers).get('Authorization') === `Bearer ${connection.token}`,
          ),
        ).toBe(true);
      } finally {
        sessionStorage.removeItem(key);
      }
    },
  );

  it('rejects combining a development bridge with local-only mode before connecting', async () => {
    const fetch = vi.spyOn(window, 'fetch');
    const instance = createAinotation({
      mcp: false,
      development: { bridge: '/__ainotation', projectName: 'test' },
    });
    instances.push(instance);
    await expect(instance.mount()).rejects.toThrow(
      'Local-only mode (mcp: false) cannot use a development bridge.',
    );
    expect(instance.mounted).toBe(false);
    expect(document.querySelector('ainotation-inspector-shell')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears all saved markers and an active draft through the toolbar and persists the result', async () => {
    const { shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'First saved note');
    select(buttons[1]!);
    await save(shell, 'Second saved note');
    select(buttons[0]!);
    action(shell, { type: 'draft', value: 'Unsent note' });
    await vi.waitFor(async () => expect((await read())?.draft.text).toBe('Unsent note'));
    await shell.updateComplete;
    shell
      .shadowRoot!.querySelector<HTMLButtonElement>('[aria-label="Clear all annotations"]')!
      .click();
    await vi.waitFor(async () => {
      expect(shell.view.document?.annotations).toEqual([]);
      expect(shell.view).toMatchObject({
        selected: [],
        draft: '',
        editorOpen: false,
        marker: null,
        picking: true,
        saving: false,
      });
      expect((await read())?.document.annotations).toEqual([]);
      expect((await read())?.draft).toMatchObject({ text: '', targets: [], editorOpen: false });
      expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(0);
    });
    expect(
      (await read())?.operations.filter((operation) => operation.kind === 'delete'),
    ).toHaveLength(2);
    expect(shell.expanded).toBe(true);
  });

  it.each(['Close inspector', 'shortcut'])(
    'hides selection on %s and restores it without changing persistent data',
    async (closeWith) => {
      const { instance, shell, buttons, read } = await setup();
      await selectMultiple(shell, buttons);
      await save(shell, 'Saved feedback survives closing');
      const saved = instance.getDocument();
      await selectMultiple(shell, buttons);
      action(shell, { type: 'draft', value: 'Keep this unsent text' });
      const targets = structuredClone(shell.view.selected);
      const marker = structuredClone(shell.view.marker);
      const selection = overlay('selection');
      const markers = overlay('markers');
      await vi.waitFor(async () => {
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(2);
        expect(markers.shadowRoot!.querySelectorAll('.marker')).toHaveLength(2);
        expect((await read())?.draft).toMatchObject({
          text: 'Keep this unsent text',
          targets,
          marker,
          editorOpen: true,
        });
      });
      const before = await read();
      await shell.updateComplete;
      if (closeWith === 'shortcut') {
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            code: 'KeyA',
            altKey: true,
            shiftKey: true,
            bubbles: true,
            cancelable: true,
          }),
        );
      } else
        shell.shadowRoot!.querySelector<HTMLButtonElement>(`[aria-label="${closeWith}"]`)!.click();
      await vi.waitFor(async () => {
        expect(shell.expanded).toBe(false);
        expect(shell.view).toMatchObject({
          picking: false,
          selected: targets,
          draft: 'Keep this unsent text',
          marker,
          editorOpen: true,
        });
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
        expect(getComputedStyle(markers).display).toBe('none');
        expect(instance.getDocument()).toEqual(saved);
        expect(await read()).toEqual(before);
      });
      const hostClick = vi.fn();
      buttons[0]!.addEventListener('click', hostClick, { once: true });
      buttons[0]!.click();
      expect(hostClick).toHaveBeenCalledOnce();
      expect(shell.view.selected).toEqual(targets);
      await shell.updateComplete;
      shell.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
      await vi.waitFor(async () => {
        expect(shell.view).toMatchObject({
          picking: true,
          selected: targets,
          draft: 'Keep this unsent text',
          marker,
          editorOpen: true,
        });
        expect(selection.shadowRoot!.querySelectorAll('.rect')).toHaveLength(2);
        expect(getComputedStyle(markers).display).toBe('block');
        expect(
          markers.shadowRoot!.querySelector('[aria-label="Edit annotation 1"]'),
        ).not.toBeNull();
        expect(markers.shadowRoot!.querySelector('[aria-label="New feedback"]')).not.toBeNull();
        expect(instance.getDocument()).toEqual(saved);
        expect(await read()).toEqual(before);
      });
    },
  );

  it.each(['draft', 'save'] as const)(
    'reconciles an immediate %s action after pushState before it can modify the previous page',
    async (firstAction) => {
      const { instance, shell, buttons, read, projectId, pageKeys } = await setup();
      const originalUrl = location.href;
      const originalState = history.state;
      const nextUrl = new URL(originalUrl);
      nextUrl.searchParams.set('ainotation-page', crypto.randomUUID());
      pageKeys.push(JSON.stringify([projectId, nextUrl.href]));
      try {
        select(buttons[0]!);
        await save(shell, 'Saved on page A');
        select(buttons[1]!);
        action(shell, { type: 'draft', value: 'Unsent draft on page A' });
        await vi.waitFor(async () => {
          expect((await read())?.draft).toMatchObject({
            text: 'Unsent draft on page A',
            targets: shell.view.selected,
            marker: shell.view.marker,
            editorOpen: true,
          });
        });
        const before = await read();

        // No yield between navigation and actions: the 500 ms poll cannot handle this change.
        history.pushState(null, '', nextUrl);
        if (firstAction === 'save') action(shell, { type: 'save' });
        action(shell, { type: 'draft', value: 'Must not leak into page A' });
        action(shell, { type: 'save' });
        expect(shell.view.storage).toBe('loading');
        expect(shell.view.document).toBeNull();
        expect(shell.view.draft).toBe('');
        expect(shell.view.selected).toEqual([]);
        expect(shell.view.marker).toBeNull();
        expect(shell.view.editorOpen).toBe(false);
        expect(getComputedStyle(overlay('markers')).display).toBe('none');
        await vi.waitFor(() => {
          expect(shell.view.storage).toBe('ready');
          expect(shell.view.document?.url).toBe(nextUrl.href);
          expect(shell.view.picking).toBe(true);
        });
        expect(instance.getDocument()).toMatchObject({ url: nextUrl.href, annotations: [] });
        expect(instance.getDocument()!.id).not.toBe(before!.document.id);
        expect(await read()).toEqual(before);
        expect(await read(nextUrl.href)).toMatchObject({
          document: { url: nextUrl.href, annotations: [] },
          operations: [],
          draft: { text: '', editingId: null, targets: [] },
        });

        select(buttons[1]!);
        await save(shell, 'Saved on page B');
        await vi.waitFor(async () => {
          const saved = await read(nextUrl.href);
          expect(saved?.document.annotations).toHaveLength(1);
          expect(saved?.document.annotations[0]).toMatchObject({
            comment: 'Saved on page B',
            page: { url: nextUrl.href },
            marker: { targetId: saved!.document.annotations[0]!.targets[0]!.id },
          });
          expect(saved?.draft).toMatchObject({
            text: '',
            targets: [],
            editingId: null,
            editorOpen: false,
          });
        });
        expect(await read()).toEqual(before);
      } finally {
        instance.destroy();
        history.replaceState(originalState, '', originalUrl);
      }
    },
  );

  it('adds, edits and deletes a persisted note with stable document, annotation and target IDs', async () => {
    const { instance, shell, buttons, read } = await setup();
    const documentId = instance.getDocument()!.id;
    select(buttons[0]!);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    const target = shell.view.selected[0]!;
    const marker = structuredClone(shell.view.marker);
    expect(target).toMatchObject({ selector: `#${buttons[0]!.id}`, text: 'First target' });
    expect(marker).toMatchObject({
      targetId: target.id,
      space: 'document',
      x: Math.round(target.rect.x + target.rect.width / 2) + scrollX,
      y: Math.round(target.rect.y + target.rect.height / 2) + scrollY,
    });
    await save(shell, 'Original note');
    const original = instance.getDocument()!.annotations[0]!;
    expect(original.targets).toEqual([target]);
    expect(original.marker).toEqual(marker);
    expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(1);

    action(shell, { type: 'edit', id: original.id });
    expect(shell.view.editingId).toBe(original.id);
    expect(shell.view.draft).toBe('Original note');
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.selected).toEqual(original.targets);
    await save(shell, 'Revised note');
    const revised = instance.getDocument()!;
    expect(revised.id).toBe(documentId);
    expect(revised.annotations).toHaveLength(1);
    expect(revised.annotations[0]).toMatchObject({
      id: original.id,
      createdAt: original.createdAt,
      comment: 'Revised note',
      targets: original.targets,
      marker,
    });
    await vi.waitFor(async () => {
      const saved = await read();
      expect(saved?.document).toEqual(revised);
      expect(saved?.draft).toMatchObject({
        text: '',
        editingId: null,
        targets: [],
        editorOpen: false,
      });
      expect(saved?.draft.marker).toBeUndefined();
      expect(saved?.operations).toMatchObject([
        { kind: 'upsert', annotation: original },
        { kind: 'upsert', annotation: revised.annotations[0] },
      ]);
    });

    action(shell, { type: 'delete', id: original.id });
    await vi.waitFor(async () => {
      expect(instance.getDocument()).toMatchObject({ id: documentId, annotations: [] });
      expect(shell.view.editingId).toBeNull();
      expect(shell.view.draft).toBe('');
      expect(shell.view.picking).toBe(true);
      expect(overlay('markers').shadowRoot!.querySelectorAll('.marker')).toHaveLength(0);
      const saved = await read();
      expect(saved?.document).toMatchObject({ id: documentId, annotations: [] });
      expect(saved?.draft).toMatchObject({ text: '', editingId: null });
      expect(saved?.operations.at(-1)).toMatchObject({ kind: 'delete', annotationId: original.id });
    });
  });

  it('adds and edits feedback through the inline marker controls while selection stays active', async () => {
    const { instance, shell, buttons, read } = await setup();
    const markers = overlay('markers').shadowRoot!;
    select(buttons[0]!);
    await vi.waitFor(() => {
      expect(markers.querySelector('[aria-label="New annotation"]')).not.toBeNull();
      expect(markers.querySelector('[role="dialog"][aria-label="New feedback"]')).not.toBeNull();
      expect(markers.querySelector<HTMLButtonElement>('.primary')!.disabled).toBe(true);
    });
    const input = markers.querySelector('textarea')!;
    input.value = 'Added inline';
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const add = markers.querySelector<HTMLButtonElement>('.primary')!;
    expect(add.getAttribute('aria-label')).toBe('Add');
    expect(add.disabled).toBe(false);
    add.click();
    await vi.waitFor(async () => {
      expect(instance.getDocument()!.annotations).toHaveLength(1);
      expect(shell.view).toMatchObject({
        picking: true,
        saving: false,
        selected: [],
        draft: '',
        marker: null,
        editorOpen: false,
      });
      expect(markers.querySelector('[aria-label="New annotation"]')).toBeNull();
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      expect((await read())?.document).toEqual(instance.getDocument());
    });
    const original = instance.getDocument()!.annotations[0]!;
    markers.querySelector<HTMLButtonElement>('[aria-label="Edit annotation 1"]')!.click();
    await vi.waitFor(() => {
      expect(shell.view).toMatchObject({
        picking: true,
        editingId: original.id,
        editorOpen: true,
        selected: original.targets,
      });
      expect(markers.querySelector('[role="dialog"][aria-label="Edit feedback"]')).not.toBeNull();
      expect(markers.querySelectorAll('.marker')).toHaveLength(1);
    });
    const edit = markers.querySelector('textarea')!;
    edit.value = 'Edited inline';
    edit.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    const submit = markers.querySelector<HTMLButtonElement>('.primary')!;
    expect(submit.getAttribute('aria-label')).toBe('Save');
    submit.click();
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({
        picking: true,
        saving: false,
        selected: [],
        draft: '',
        editingId: null,
        marker: null,
        editorOpen: false,
      });
      expect(instance.getDocument()!.annotations).toEqual([
        { ...original, comment: 'Edited inline', updatedAt: expect.any(String) },
      ]);
      expect((await read())?.document).toEqual(instance.getDocument());
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      expect(markers.querySelectorAll('.marker')).toHaveLength(1);
    });
  });

  it.each(['action', 'inline', 'Escape'] as const)(
    'cancels new and saved editors via %s without changing saved feedback or leaving selection mode',
    async (cancelWith) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Keep the saved note');
      const savedDocument = instance.getDocument()!;
      const before = await read();
      for (const mode of ['new', 'edit'] as const) {
        if (mode === 'new') select(buttons[1]!);
        else action(shell, { type: 'edit', id: savedDocument.annotations[0]!.id });
        action(shell, { type: 'draft', value: 'Discard this work' });
        await vi.waitFor(async () => {
          expect(shell.view.picking).toBe(true);
          expect(shell.view.editorOpen).toBe(true);
          expect((await read())?.draft.text).toBe('Discard this work');
        });
        const markers = overlay('markers').shadowRoot!;
        if (cancelWith === 'action') action(shell, { type: 'cancel-edit' });
        else if (cancelWith === 'inline') {
          [...markers.querySelectorAll('button')]
            .find((button) => button.getAttribute('aria-label') === 'Cancel')!
            .click();
        } else {
          markers.querySelector('textarea')!.dispatchEvent(
            new KeyboardEvent('keydown', {
              key: 'Escape',
              bubbles: true,
              composed: true,
              cancelable: true,
            }),
          );
        }
        await vi.waitFor(async () => {
          expect(shell.view).toMatchObject({
            picking: true,
            selected: [],
            draft: '',
            editingId: null,
            editorOpen: false,
            marker: null,
          });
          expect(instance.getDocument()).toEqual(savedDocument);
          expect(markers.querySelector('[role="dialog"]')).toBeNull();
          expect(markers.querySelector('[aria-label="New annotation"]')).toBeNull();
          expect(markers.querySelectorAll('.marker')).toHaveLength(1);
          const persisted = await read();
          expect(persisted?.document).toEqual(savedDocument);
          expect(persisted?.operations).toEqual(before!.operations);
          expect(persisted?.draft).toMatchObject({
            text: '',
            editingId: null,
            targets: [],
            editorOpen: false,
          });
          expect(persisted?.draft.marker).toBeUndefined();
        });
      }
    },
  );

  it('clears the active editor and its persisted draft when the inline Delete button is used', async () => {
    const { instance, shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'Delete this note');
    const note = instance.getDocument()!.annotations[0]!;
    const markers = overlay('markers').shadowRoot!;
    markers.querySelector<HTMLButtonElement>('[aria-label="Edit annotation 1"]')!.click();
    action(shell, { type: 'draft', value: 'Unsent edit to delete' });
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({ picking: true, editingId: note.id, editorOpen: true });
      expect((await read())?.draft.text).toBe('Unsent edit to delete');
    });
    [...markers.querySelectorAll('button')]
      .find((button) => button.getAttribute('aria-label') === 'Delete')!
      .click();
    await vi.waitFor(async () => {
      expect(instance.getDocument()!.annotations).toEqual([]);
      expect(shell.view).toMatchObject({
        picking: true,
        selected: [],
        draft: '',
        editingId: null,
        editorOpen: false,
        marker: null,
      });
      expect(markers.querySelectorAll('.marker')).toHaveLength(0);
      expect(markers.querySelector('[role="dialog"]')).toBeNull();
      const persisted = await read();
      expect(persisted?.document.annotations).toEqual([]);
      expect(persisted?.draft).toMatchObject({
        text: '',
        editingId: null,
        targets: [],
        editorOpen: false,
      });
      expect(persisted?.draft.marker).toBeUndefined();
      expect(persisted?.operations.at(-1)).toMatchObject({ kind: 'delete', annotationId: note.id });
    });
  });

  it.each(['page', 'targets'] as const)(
    'preserves the captured %s when only a saved comment is edited after geometry changes',
    async (snapshot) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Original geometry');
      const original = instance.getDocument()!.annotations[0]!;
      if (snapshot === 'page')
        vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(window.innerWidth + 100);
      else buttons[0]!.style.transform = 'translateY(80px)';
      action(shell, { type: 'edit', id: original.id });
      await save(shell, 'Comment only');
      await vi.waitFor(async () => {
        const revised = instance.getDocument()!.annotations[0]!;
        expect(revised.id).toBe(original.id);
        expect(revised.marker).toEqual(original.marker);
        expect(revised[snapshot]).toEqual(original[snapshot]);
        expect((await read())?.document.annotations).toEqual([revised]);
      });
    },
  );

  it.each(['new note', 'edit'] as const)(
    'restores saved notes and an unsent %s after destroy/remount',
    async (mode) => {
      const { instance, shell, buttons, read } = await setup();
      select(buttons[0]!);
      await save(shell, 'Saved note');
      const savedDocument = instance.getDocument()!;
      const note = savedDocument.annotations[0]!;
      if (mode === 'edit') action(shell, { type: 'edit', id: note.id });
      else select(buttons[1]!);
      const targets = structuredClone(shell.view.selected);
      const marker = structuredClone(shell.view.marker);
      const editingId = mode === 'edit' ? note.id : null;
      action(shell, { type: 'draft', value: 'Unsent work' });
      await vi.waitFor(async () => {
        expect((await read())?.draft).toMatchObject({
          text: 'Unsent work',
          editingId,
          targets,
          marker,
          editorOpen: true,
        });
      });
      const before = await read();

      instance.destroy();
      expect(shell.isConnected).toBe(false);
      await instance.mount();
      const restored = document.querySelector('ainotation-inspector-shell')!;
      expect(restored).not.toBe(shell);
      await vi.waitFor(async () => {
        expect(instance.getDocument()).toEqual(savedDocument);
        expect(restored.view).toMatchObject({
          draft: 'Unsent work',
          editingId,
          selected: targets,
          marker,
          editorOpen: true,
          picking: false,
        });
        expect(restored.expanded).toBe(false);
        expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
        expect(getComputedStyle(overlay('markers')).display).toBe('none');
        expect(restored.view.availability[note.targets[0]!.id]).toBe('available');
        expect(await read()).toEqual(before);
      });
      await restored.updateComplete;
      restored.shadowRoot!.querySelector<HTMLButtonElement>('.launcher')!.click();
      await vi.waitFor(async () => {
        expect(restored.view.picking).toBe(true);
        expect(restored.view.editorOpen).toBe(true);
        expect(restored.view.selected).toEqual(targets);
        expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(
          targets.length,
        );
        const markers = overlay('markers');
        expect(getComputedStyle(markers).display).toBe('block');
        expect(markers.shadowRoot!.querySelectorAll('.marker')).toHaveLength(
          mode === 'edit' ? 1 : 2,
        );
        expect(
          markers.shadowRoot!.querySelector('[aria-label="Edit annotation 1"]'),
        ).not.toBeNull();
        expect(markers.shadowRoot!.querySelector('textarea')!.value).toBe('Unsent work');
        expect(await read()).toEqual(before);
      });
    },
  );

  it('retains feedback, outbox and unsent text when clipboard access fails', async () => {
    const write = vi
      .spyOn(navigator.clipboard, 'write')
      .mockRejectedValue(new DOMException('Denied', 'NotAllowedError'));
    const { instance, shell, buttons, read } = await setup();
    select(buttons[0]!);
    await save(shell, 'Keep this feedback');
    select(buttons[1]!);
    action(shell, { type: 'draft', value: 'Keep this draft too' });
    await vi.waitFor(async () => {
      expect((await read())?.draft.text).toBe('Keep this draft too');
    });
    const before = await read();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));

    action(shell, { type: 'copy' });
    await vi.waitFor(() => {
      expect(shell.view.message).toContain('Clipboard access failed');
    });
    expect(write).toHaveBeenCalledOnce();
    const copied = await write.mock.calls[0]![0][0]!.getType('text/plain');
    expect(await copied.text()).toContain('Keep this feedback');
    expect(writeText).not.toHaveBeenCalled();
    await expect(instance.copyFeedback()).rejects.toThrow('Clipboard access failed');
    expect(instance.getDocument()).toEqual(before!.document);
    expect(shell.view.draft).toBe('Keep this draft too');
    expect(await read()).toEqual(before);
  });

  it('marks a removed saved target missing and does not rebind it to an identical replacement', async () => {
    const { instance, shell, fixture, buttons, read } = await setup();
    const original = buttons[0]!;
    select(original);
    await save(shell, 'Watch this target');
    const note = instance.getDocument()!.annotations[0]!;
    const target = note.targets[0]!;
    await vi.waitFor(async () => expect((await read())?.draft.targets).toEqual([]));
    expect(shell.view.availability[target.id]).toBe('available');

    original.replaceWith(original.cloneNode(true));
    await vi.waitFor(() => expect(shell.view.availability[target.id]).toBe('missing'));
    expect(shell.view.selected).toEqual([]);
    action(shell, { type: 'edit', id: note.id });
    expect(shell.view.selected).toEqual([target]);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    expect(shell.view.availability[target.id]).toBe('missing');
    expect(instance.getDocument()!.annotations).toEqual([note]);
    await vi.waitFor(async () => {
      expect((await read())?.draft).toMatchObject({
        targets: [target],
        editingId: note.id,
        editorOpen: true,
      });
      expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(0);
      expect(
        overlay('markers').shadowRoot!.querySelector<HTMLButtonElement>(
          '[aria-label="Edit annotation 1"]',
        )!.title,
      ).toBe('Target unavailable');
    });

    fixture.querySelector(`#${original.id}`)!.replaceWith(original);
    await vi.waitFor(() => {
      expect(shell.view.availability[target.id]).toBe('available');
      expect(overlay('selection').shadowRoot!.querySelectorAll('.rect')).toHaveLength(1);
    });
    expect(shell.view.selected[0]!.id).toBe(target.id);
  });

  it('saves Shift-selected targets and edits their original IDs without selecting their parent', async () => {
    const { instance, shell, buttons, read } = await setup();
    await selectMultiple(shell, buttons);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.selected.map((target) => target.selector)).toEqual(
      buttons.map((button) => `#${button.id}`),
    );
    const targetIds = shell.view.selected.map((target) => target.id);
    expect(new Set(targetIds).size).toBe(2);
    expect(shell.view.marker?.targetId).toBe(targetIds[1]);
    expect(shell.view.marker?.ratioX).toBeCloseTo(0.5, 1);
    expect(shell.view.marker?.ratioY).toBeCloseTo(0.5, 1);
    const marker = structuredClone(shell.view.marker);
    await save(shell, 'Compare these targets');
    const note = instance.getDocument()!.annotations[0]!;
    expect(note.targets.map((target) => target.id)).toEqual(targetIds);
    expect(note.marker).toEqual(marker);
    expect(shell.view.selected).toEqual([]);
    action(shell, { type: 'edit', id: note.id });
    expect(shell.view.selected.map((target) => target.id)).toEqual(targetIds);
    expect(shell.view.picking).toBe(true);
    expect(shell.view.editorOpen).toBe(true);
    await vi.waitFor(async () => {
      const saved = await read();
      expect(saved?.document.annotations).toEqual([note]);
      expect(saved?.draft).toMatchObject({
        targets: note.targets,
        editingId: note.id,
        marker,
        editorOpen: true,
      });
    });

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true, bubbles: true }),
    );
    select(buttons[0]!, true);
    select(buttons[1]!, true);
    select(buttons[0]!, true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    await vi.waitFor(async () => {
      expect(shell.view).toMatchObject({
        picking: true,
        editorOpen: true,
        editingId: null,
        draft: '',
      });
      expect(shell.view.selected.map((target) => target.id)).toEqual([targetIds[1]]);
      const saved = await read();
      expect(saved?.document.annotations).toEqual([note]);
      expect(saved?.draft.targets.map((target) => target.id)).toEqual([targetIds[1]]);
      expect(saved?.draft.marker?.targetId).toBe(targetIds[1]);
    });
  });
});
