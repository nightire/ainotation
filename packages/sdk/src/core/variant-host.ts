export interface VariantSnapshot {
  readonly generation: number;
  readonly variantId: string;
}
export interface VariantGroupOptions {
  explorationId: string;
  targetIds: readonly string[];
  generations: readonly { generation: number; variants: readonly string[] }[];
}
export interface VariantGroup {
  getSnapshot(): VariantSnapshot;
  subscribe(listener: () => void): () => void;
  bind(targetId: string, element: Element, snapshot: VariantSnapshot): () => void;
  dispose(): void;
}
export const originalVariantSnapshot: VariantSnapshot = Object.freeze({
  generation: 0,
  variantId: 'original',
});
export interface VariantBinding {
  targetId: string;
  element: Element;
  snapshot: VariantSnapshot;
}
export interface VariantProvider {
  options: VariantGroupOptions;
  bindings: Set<VariantBinding>;
  snapshot: VariantSnapshot;
  failed: boolean;
  set(snapshot: VariantSnapshot): void;
}
interface Registry {
  providers: Set<VariantProvider>;
  listeners: Set<() => void>;
  attributes: WeakMap<
    Element,
    { count: number; before: Map<string, string | null>; current: Record<string, string> }
  >;
  notify(): void;
}
const registryKey = Symbol.for('ainotation.ui-variants.v1');
export function variantRegistry(): Registry {
  const scope = globalThis as unknown as Record<symbol, Registry | undefined>;
  if (!scope[registryKey]) {
    let scheduled = false;
    const registry: Registry = {
      providers: new Set(),
      listeners: new Set(),
      attributes: new WeakMap(),
      notify() {
        if (scheduled) return;
        scheduled = true;
        queueMicrotask(() => {
          scheduled = false;
          for (const listener of registry.listeners) listener();
        });
      },
    };
    scope[registryKey] = registry;
  }
  return scope[registryKey]!;
}

export function originalVariantGroup(): VariantGroup {
  return {
    getSnapshot: () => originalVariantSnapshot,
    subscribe: () => () => {},
    bind: () => () => {},
    dispose() {},
  };
}

/** Host rendering stays with its framework; bindings are explicit, never selector guesses. */
export function defineVariants(options: VariantGroupOptions): VariantGroup {
  if (typeof document === 'undefined') return originalVariantGroup();
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (
    !uuid.test(options.explorationId) ||
    !options.targetIds.length ||
    options.targetIds.length > 20 ||
    new Set(options.targetIds).size !== options.targetIds.length ||
    options.targetIds.some((id) => !uuid.test(id)) ||
    !options.generations.length ||
    options.generations.length > 20 ||
    new Set(options.generations.map((item) => item.generation)).size !==
      options.generations.length ||
    options.generations.some(
      (item) =>
        !Number.isInteger(item.generation) ||
        item.generation < 1 ||
        item.generation > 10000 ||
        !item.variants.length ||
        item.variants.length > 6 ||
        new Set(item.variants).size !== item.variants.length ||
        item.variants.some((id) => id === 'original' || !/^[a-z][a-z0-9-]{0,47}$/.test(id)),
    )
  )
    throw new Error('Invalid UI Variants host declaration');
  const registry = variantRegistry();
  const listeners = new Set<() => void>();
  const cleanups = new Set<() => void>();
  let disposed = false;
  const provider: VariantProvider = {
    options: structuredClone(options),
    bindings: new Set(),
    snapshot: originalVariantSnapshot,
    failed: false,
    set(snapshot) {
      if (
        disposed ||
        (provider.snapshot.generation === snapshot.generation &&
          provider.snapshot.variantId === snapshot.variantId)
      )
        return;
      provider.snapshot = Object.freeze({ ...snapshot });
      provider.failed = false;
      for (const listener of listeners) {
        try {
          listener();
        } catch {
          provider.failed = true;
        }
      }
      registry.notify();
    },
  };
  registry.providers.add(provider);
  registry.notify();
  return {
    getSnapshot: () => provider.snapshot,
    subscribe(listener) {
      if (disposed) return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    bind(targetId, element, snapshot) {
      if (disposed) return () => {};
      if (
        !provider.options.targetIds.includes(targetId) ||
        element.ownerDocument !== document ||
        !snapshot ||
        (snapshot.generation === 0 && snapshot.variantId !== 'original') ||
        (snapshot.generation !== 0 &&
          !provider.options.generations.some(
            (item) =>
              item.generation === snapshot.generation &&
              (snapshot.variantId === 'original' || item.variants.includes(snapshot.variantId)),
          ))
      )
        throw new Error('Invalid UI Variants target binding');
      const binding: VariantBinding = { targetId, element, snapshot: { ...snapshot } };
      const attributes = {
        'data-ainotation-exploration': provider.options.explorationId,
        'data-ainotation-generation': String(snapshot.generation),
        'data-ainotation-slot': targetId,
        'data-ainotation-variant': snapshot.variantId,
      };
      const ownership = registry.attributes.get(element) ?? {
        count: 0,
        before: new Map(Object.keys(attributes).map((key) => [key, element.getAttribute(key)])),
        current: attributes,
      };
      ownership.count++;
      ownership.current = attributes;
      registry.attributes.set(element, ownership);
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      provider.bindings.add(binding);
      const cleanup = () => {
        if (!provider.bindings.delete(binding)) return;
        if (--ownership.count === 0) {
          for (const [key, value] of Object.entries(ownership.current)) {
            if (element.getAttribute(key) !== value) continue;
            const previous = ownership.before.get(key);
            if (previous === null || previous === undefined) element.removeAttribute(key);
            else element.setAttribute(key, previous);
          }
          registry.attributes.delete(element);
        }
        cleanups.delete(cleanup);
        registry.notify();
      };
      cleanups.add(cleanup);
      registry.notify();
      return cleanup;
    },
    dispose() {
      if (disposed) return;
      provider.set(originalVariantSnapshot);
      disposed = true;
      listeners.clear();
      for (const cleanup of cleanups) cleanup();
      registry.providers.delete(provider);
      registry.notify();
    },
  };
}
