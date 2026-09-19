import type { VariantExploration, VariantReport } from '@ainotation/schema';
import {
  variantRegistry,
  originalVariantSnapshot,
  type VariantProvider,
  type VariantSnapshot,
  type VariantBinding,
} from './variant-host';
import { parentElement } from './dom';

export type VariantProblem =
  | 'missing'
  | 'duplicate'
  | 'overlap'
  | 'mismatch'
  | 'render'
  | 'cleanup';
export interface VariantPreviewState {
  status: 'waiting' | 'ready' | 'switching' | 'error' | 'completed';
  generation: number;
  variantId: string;
  problem: VariantProblem | null;
}
export const emptyVariantPreview = (): VariantPreviewState => ({
  status: 'waiting',
  generation: 0,
  variantId: 'original',
  problem: null,
});
const same = (a: VariantSnapshot, b: VariantSnapshot) =>
  a.generation === b.generation && a.variantId === b.variantId;
const contains = (a: Element, b: Element) => {
  for (let node: Element | null = b; node; node = parentElement(node)) if (node === a) return true;
  return false;
};
export function overlappingVariantTargets(elements: Element[]) {
  return elements.some((element, index) =>
    elements.some((other, otherIndex) => index !== otherIndex && contains(element, other)),
  );
}

export function createVariantsController(options: {
  onChange: () => void;
  onReport: (report: VariantReport) => boolean | void;
}) {
  const registry = variantRegistry();
  const clientId = crypto.randomUUID();
  let exploration: VariantExploration | undefined;
  let desired: VariantSnapshot = originalVariantSnapshot;
  let committed: VariantSnapshot = originalVariantSnapshot;
  let view = emptyVariantPreview();
  let stopped = false;
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let signature = '';
  let reportSignature = '';
  let stickyError: VariantProblem | null = null;
  const owned = new Set<VariantProvider>();
  let bindings: VariantBinding[] = [];
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        const element =
          record.target instanceof Element ? record.target : record.target.parentElement;
        return !element?.closest('[data-ainotation-ui], ainotation-inspector-shell');
      })
    )
      schedule();
  });
  const resize = new ResizeObserver(schedule);
  const observedNodes = new Set<Element>();
  const life = new AbortController();
  const providers = () =>
    [...registry.providers].filter(
      (provider) => provider.options.explorationId === exploration?.id,
    );
  function schedule() {
    if (pending || stopped) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      if (!stopped) reconcile();
    });
  }
  function resetProviders() {
    for (const provider of owned) provider.set(originalVariantSnapshot);
    owned.clear();
    bindings = [];
    clearTimeout(timer);
    timer = undefined;
  }
  function publishView(next: VariantPreviewState) {
    view = next;
    const nodes = new Set(
      providers().flatMap((provider) =>
        [...provider.bindings]
          .filter((binding) => binding.element.isConnected)
          .map((binding) => binding.element),
      ),
    );
    for (const node of observedNodes) {
      if (!nodes.has(node)) {
        resize.unobserve(node);
        observedNodes.delete(node);
      }
    }
    for (const node of nodes) {
      if (!observedNodes.has(node)) {
        resize.observe(node);
        observedNodes.add(node);
      }
      let root = node.getRootNode();
      while (root instanceof ShadowRoot) {
        observer.observe(root, { subtree: true, childList: true, attributes: true });
        root = root.host.getRootNode();
      }
    }
    const geometry = bindings.map(({ element }) => {
      const r = element.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
    const nextSignature = JSON.stringify([next, geometry, exploration?.id, exploration?.revision]);
    if (signature !== nextSignature) {
      signature = nextSignature;
      options.onChange();
    }
    if (
      exploration &&
      ['requested', 'published'].includes(exploration.status) &&
      desired.generation === exploration.generation
    ) {
      const report = {
        clientId,
        generation: exploration.generation,
        status:
          next.status === 'ready'
            ? ('ready' as const)
            : next.status === 'error'
              ? ('error' as const)
              : ('waiting' as const),
        detail: next.problem ?? '',
        observedAt: new Date().toISOString(),
      };
      const key = JSON.stringify([
        exploration.id,
        exploration.generation,
        report.status,
        report.detail,
      ]);
      if (reportSignature !== key) {
        if (options.onReport(report) !== false) reportSignature = key;
      }
    }
  }
  function reconcile() {
    observer.disconnect();
    bindings = [];
    if (!exploration) {
      publishView(emptyVariantPreview());
      return;
    }
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
    });
    const candidates = providers();
    if (exploration.status === 'completed') {
      resetProviders();
      publishView({
        ...emptyVariantPreview(),
        status: candidates.length ? 'error' : 'completed',
        problem: candidates.length ? 'cleanup' : null,
      });
      return;
    }
    const manifest = exploration.manifest;
    let problem: VariantProblem | null = null;
    const provider = candidates[0];
    if (!manifest || !provider) problem = 'missing';
    else if (candidates.length !== 1) problem = 'duplicate';
    else {
      const declared = provider.options.generations.find(
        (item) => item.generation === manifest.generation,
      );
      if (
        !declared ||
        declared.variants.length !== manifest.choices.length ||
        manifest.choices.some((choice) => !declared.variants.includes(choice.id)) ||
        provider.options.targetIds.length !== exploration.targetIds.length ||
        exploration.targetIds.some((id) => !provider.options.targetIds.includes(id))
      )
        problem = 'mismatch';
      else {
        owned.add(provider);
        provider.set(desired);
        if (provider.failed) problem = 'render';
        for (const targetId of exploration.targetIds) {
          const matches = [...provider.bindings].filter(
            (binding) => binding.targetId === targetId && binding.element.isConnected,
          );
          if (matches.length !== 1) {
            problem ??= matches.length ? 'duplicate' : 'missing';
            continue;
          }
          const binding = matches[0]!;
          if (!same(binding.snapshot, desired)) {
            problem ??= 'mismatch';
            continue;
          }
          if (
            binding.element.getAttribute('data-ainotation-exploration') !== exploration.id ||
            binding.element.getAttribute('data-ainotation-generation') !==
              String(desired.generation) ||
            binding.element.getAttribute('data-ainotation-slot') !== targetId ||
            binding.element.getAttribute('data-ainotation-variant') !== desired.variantId
          ) {
            problem ??= 'mismatch';
            continue;
          }
          const rect = binding.element.getBoundingClientRect();
          if (
            !rect.width ||
            !rect.height ||
            getComputedStyle(binding.element).visibility === 'hidden'
          ) {
            problem ??= 'missing';
            continue;
          }
          bindings.push(binding);
        }
        if (overlappingVariantTargets(bindings.map((binding) => binding.element)))
          problem = 'overlap';
      }
    }
    if (problem) {
      publishView({
        ...desired,
        status: timer
          ? 'switching'
          : stickyError || ['duplicate', 'overlap', 'render'].includes(problem)
            ? 'error'
            : 'waiting',
        problem: stickyError ?? problem,
      });
    } else {
      clearTimeout(timer);
      timer = undefined;
      committed = desired;
      publishView({ ...desired, status: stickyError ? 'error' : 'ready', problem: stickyError });
    }
  }
  registry.listeners.add(schedule);
  window.addEventListener('resize', schedule, { signal: life.signal });
  window.addEventListener('scroll', schedule, { signal: life.signal, capture: true });
  return {
    state: () => ({ ...view }),
    rect(targetId: string) {
      const node = bindings.find((binding) => binding.targetId === targetId)?.element;
      return node?.isConnected ? node.getBoundingClientRect() : null;
    },
    elements: () =>
      providers().flatMap((provider) =>
        [...provider.bindings]
          .filter((binding) => binding.element.isConnected)
          .map((binding) => binding.element),
      ),
    sync(next?: VariantExploration) {
      const previous = exploration;
      exploration = next;
      if (previous?.id !== next?.id) {
        resetProviders();
        stickyError = null;
        reportSignature = '';
        desired = originalVariantSnapshot;
        committed = originalVariantSnapshot;
      }
      // Restoring Original must not depend on a valid current registration.
      // Generation 0 also works for owned hosts that lack the newly published round.
      if (next?.status === 'cancelled' && previous?.status !== 'cancelled') resetProviders();
      if (
        next?.status === 'cancelled' ||
        (next?.manifest && desired.generation !== next.manifest.generation)
      ) {
        desired = Object.freeze({
          generation: next.manifest?.generation ?? 0,
          variantId: 'original',
        });
        committed = desired;
        stickyError = null;
      }
      if (
        next?.status === 'accepted' &&
        next.decision?.variantId &&
        previous?.revision !== next.revision
      )
        desired = Object.freeze({
          generation: next.generation,
          variantId: next.decision.variantId,
        });
      schedule();
    },
    select(variantId: string) {
      const manifest = exploration?.manifest;
      if (
        !manifest ||
        !['requested', 'published'].includes(exploration!.status) ||
        !['original', ...manifest.choices.map((choice) => choice.id)].includes(variantId)
      )
        return false;
      stickyError = null;
      desired = Object.freeze({ generation: manifest.generation, variantId });
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        stickyError = view.problem ?? 'render';
        desired = committed;
        schedule();
      }, 2500);
      schedule();
      return true;
    },
    destroy() {
      stopped = true;
      resetProviders();
      registry.listeners.delete(schedule);
      observer.disconnect();
      resize.disconnect();
      observedNodes.clear();
      life.abort();
    },
  };
}
