import { afterEach, expect, it, vi } from 'vite-plus/test';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  createVariantExploration,
  transitionVariants,
  type VariantExploration,
} from '@ainotation/schema';
import { defineVariants } from './variant-host';
import { createVariantsController } from './variants-controller';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const targets = [crypto.randomUUID(), crypto.randomUUID()];
  const exploration: VariantExploration = {
    ...createVariantExploration(crypto.randomUUID(), targets),
    revision: 2,
    status: 'published',
    manifest: {
      generation: 1,
      choices: [
        { id: 'compact', label: 'Compact' },
        { id: 'broken', label: 'Broken' },
      ],
    },
  };
  const root = document.createElement('div');
  document.body.append(root);
  cleanup.push(() => root.remove());
  const onReport = vi.fn();
  const controller = createVariantsController({ onChange() {}, onReport });
  cleanup.push(() => controller.destroy());
  const host = (generations = [{ generation: 1, variants: ['compact', 'broken'] }]) => {
    const group = defineVariants({
      explorationId: exploration.id,
      targetIds: targets,
      generations,
    });
    let releases: (() => void)[] = [];
    const render = () => {
      for (const release of releases) release();
      releases = [];
      root.replaceChildren();
      const snapshot = group.getSnapshot();
      targets.forEach((targetId, index) => {
        if (snapshot.variantId === 'broken' && index === 1) return;
        const element = document.createElement(
          snapshot.variantId === 'compact' ? 'section' : 'button',
        );
        element.textContent = `${snapshot.variantId} ${index}`;
        root.append(element);
        releases.push(group.bind(targetId, element, snapshot));
      });
    };
    const unsubscribe = group.subscribe(render);
    render();
    const close = () => {
      unsubscribe();
      for (const release of releases) release();
      group.dispose();
    };
    cleanup.push(close);
    return { group, close };
  };
  return { exploration, root, targets, controller, onReport, host };
}
it('binds multiple structural branches explicitly and restores original on disposal', async () => {
  const browserErrors: string[] = [];
  const onError = (event: ErrorEvent) => browserErrors.push(event.message);
  window.addEventListener('error', onError);
  cleanup.push(() => window.removeEventListener('error', onError));
  const { exploration, root, controller, onReport, host } = fixture();
  const { group } = host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  expect(onReport.mock.calls.at(-1)?.[0]).toMatchObject({ status: 'ready', generation: 1 });
  controller.select('compact');
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({ status: 'ready', variantId: 'compact' }),
  );
  expect(root.querySelectorAll('section')).toHaveLength(2);
  expect(
    [...root.children].map((element) => element.getAttribute('data-ainotation-variant')),
  ).toEqual(['compact', 'compact']);
  expect(exploration.decision).toBeUndefined();
  controller.destroy();
  expect(group.getSnapshot()).toEqual({ generation: 0, variantId: 'original' });
  expect(root.querySelectorAll('button')).toHaveLength(2);
  await new Promise<void>((done) =>
    requestAnimationFrame(() => requestAnimationFrame(() => done())),
  );
  expect(browserErrors).toEqual([]);
});
it('rolls an incomplete switch back as a group and supports retry', async () => {
  const { exploration, root, controller, host } = fixture();
  host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  controller.select('compact');
  await vi.waitFor(() => expect(controller.state().variantId).toBe('compact'));
  controller.select('broken');
  await vi.waitFor(
    () => expect(controller.state()).toMatchObject({ status: 'error', variantId: 'compact' }),
    { timeout: 5000 },
  );
  expect(root.children).toHaveLength(2);
  controller.select('original');
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({ status: 'ready', variantId: 'original' }),
  );
});
it('recovers explicit bindings after HMR, retains old rounds and detects incomplete cleanup', async () => {
  const { exploration, controller, host } = fixture();
  const first = host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  controller.select('compact');
  await vi.waitFor(() => expect(controller.state().variantId).toBe('compact'));
  first.close();
  host([
    { generation: 1, variants: ['compact', 'broken'] },
    { generation: 2, variants: ['soft'] },
  ]);
  controller.sync({ ...exploration, generation: 2, revision: 3, status: 'requested' });
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({
      status: 'ready',
      generation: 1,
      variantId: 'compact',
    }),
  );
  controller.sync({
    ...exploration,
    generation: 2,
    revision: 4,
    manifest: { generation: 2, choices: [{ id: 'soft', label: 'Soft' }] },
  });
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({
      status: 'ready',
      generation: 2,
      variantId: 'original',
    }),
  );
  controller.sync({ ...exploration, status: 'completed' });
  await vi.waitFor(() => expect(controller.state().problem).toBe('cleanup'));
});
it('rejects overlapping and duplicate registrations without rebinding lookalike DOM', async () => {
  const { exploration, root, targets, controller, host } = fixture();
  root.innerHTML = `<button data-ainotation-exploration="${exploration.id}" data-ainotation-slot="${targets[0]}">Lookalike</button>`;
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().problem).toBe('missing'));
  expect(controller.rect(targets[0]!)).toBeNull();
  host();
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  const duplicate = defineVariants({
    explorationId: exploration.id,
    targetIds: targets,
    generations: [{ generation: 1, variants: ['compact', 'broken'] }],
  });
  cleanup.push(() => duplicate.dispose());
  await vi.waitFor(() => expect(controller.state().problem).toBe('duplicate'));
  duplicate.dispose();
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  root.children[0]!.append(root.children[1]!);
  await vi.waitFor(() => expect(controller.state().problem).toBe('overlap'));
});

it.each([
  ['cancel', 'duplicate'],
  ['delete', 'duplicate'],
  ['cancel', 'mismatch'],
  ['delete', 'mismatch'],
] as const)('restores Original on %s even with a %s host registration', async (action, problem) => {
  const { exploration, root, targets, controller, onReport, host } = fixture();
  const { group } = host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  controller.select('compact');
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({ status: 'ready', variantId: 'compact' }),
  );
  let current = exploration;
  let duplicate: ReturnType<typeof defineVariants> | undefined;
  if (problem === 'duplicate') {
    duplicate = defineVariants({
      explorationId: exploration.id,
      targetIds: targets,
      generations: [{ generation: 1, variants: ['compact', 'broken'] }],
    });
    cleanup.push(() => duplicate!.dispose());
  } else {
    // The agent published the next round before its host module finished HMR.
    current = {
      ...exploration,
      generation: 2,
      revision: 3,
      manifest: { generation: 2, choices: [{ id: 'fresh', label: 'Fresh' }] },
    };
    controller.sync(current);
  }
  await vi.waitFor(() => expect(controller.state().problem).toBe(problem));
  expect(root.querySelectorAll('section')).toHaveLength(2);
  const annotationId = crypto.randomUUID();
  let cancelled: VariantExploration;
  if (action === 'delete') {
    const document = createFeedbackDocument(location.href);
    document.annotations.push({
      id: annotationId,
      comment: 'Explore alternatives',
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
      page: {
        url: document.url,
        title: 'Test',
        viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      },
      targets: targets.map((id) => ({
        id,
        selector: 'button',
        tagName: 'button',
        text: 'Original',
        attributes: {},
        styles: {},
        shadowHosts: [],
        rect: { x: 0, y: 0, width: 100, height: 30 },
      })),
      variants: current,
      status: 'pending',
      replies: [],
    });
    const deleted = applyFeedbackOperation(document, {
      id: crypto.randomUUID(),
      kind: 'delete',
      annotationId,
    });
    cancelled = deleted.variantCleanups![0]!.variants;
  } else {
    cancelled = transitionVariants(current, {
      id: crypto.randomUUID(),
      kind: 'variants',
      annotationId,
      explorationId: current.id,
      generation: current.generation,
      revision: current.revision,
      action: { type: 'cancel', feedback: '' },
    })!;
  }
  onReport.mockClear();
  controller.sync(cancelled);
  await vi.waitFor(() => expect(root.querySelectorAll('button')).toHaveLength(2));
  expect(root.textContent).toBe('original 0original 1');
  expect(group.getSnapshot()).toEqual({ generation: 0, variantId: 'original' });
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({ variantId: 'original', problem }),
  );
  expect(controller.state().status).not.toBe('ready');
  expect(onReport).not.toHaveBeenCalled();
  if (duplicate) {
    duplicate.dispose();
    await vi.waitFor(() =>
      expect(controller.state()).toMatchObject({ status: 'ready', variantId: 'original' }),
    );
    expect(root.textContent).toBe('original 0original 1');
  }
});

it('does not report readiness for DOM metadata from a different generation', async () => {
  const { exploration, root, controller, host } = fixture();
  host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
  root.firstElementChild!.setAttribute('data-ainotation-generation', '99');
  await vi.waitFor(() =>
    expect(controller.state()).toMatchObject({ status: 'waiting', problem: 'mismatch' }),
  );
  root.firstElementChild!.setAttribute('data-ainotation-generation', '1');
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
});

it('observes initially hidden bindings when CSSOM changes make them visible', async () => {
  const { exploration, root, controller, host } = fixture();
  const sheets = document.adoptedStyleSheets;
  const sheet = new CSSStyleSheet();
  root.className = 'deferred-variants';
  sheet.replaceSync('.deferred-variants { display:none }');
  document.adoptedStyleSheets = [...sheets, sheet];
  cleanup.push(() => {
    document.adoptedStyleSheets = sheets;
  });
  host();
  controller.sync(exploration);
  await vi.waitFor(() => expect(controller.state().problem).toBe('missing'));
  sheet.replaceSync('.deferred-variants { display:block }');
  await vi.waitFor(() => expect(controller.state().status).toBe('ready'));
});

it.each([true, false])(
  'cleans overlapping binding lifetimes without removing newer metadata (old first: %s)',
  (oldFirst) => {
    const element = document.createElement('button');
    element.setAttribute('data-ainotation-variant', 'host-owned');
    document.body.append(element);
    const targetId = crypto.randomUUID();
    const group = defineVariants({
      explorationId: crypto.randomUUID(),
      targetIds: [targetId],
      generations: [{ generation: 1, variants: ['compact'] }],
    });
    cleanup.push(() => {
      group.dispose();
      element.remove();
    });
    const old = group.bind(targetId, element, { generation: 0, variantId: 'original' });
    const next = group.bind(targetId, element, { generation: 1, variantId: 'compact' });
    if (oldFirst) old();
    else next();
    expect(element.getAttribute('data-ainotation-variant')).toBe('compact');
    expect(element.getAttribute('data-ainotation-generation')).toBe('1');
    if (oldFirst) next();
    else old();
    expect(element.getAttribute('data-ainotation-variant')).toBe('host-owned');
    expect(element.hasAttribute('data-ainotation-generation')).toBe(false);
  },
);
