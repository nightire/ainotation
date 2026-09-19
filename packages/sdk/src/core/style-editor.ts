import {
  StyleChangeSchema,
  styleProperties,
  styleTargetKey,
  normalizeSharedStyles,
  type FeedbackDocument,
  type StyleChange,
  type StyleProperty,
  type TargetSnapshot,
} from '@ainotation/schema';

import {
  applyInlineStyles,
  inlineStylesChanged,
  restoreInlineStyles,
  type InlineStylePreview,
  type StyledElement,
} from './inline-styles';
type Revision = Map<string, StyleChange[]>;
type Edit = { before: Revision; after: Revision };
export type StyleLinkage = boolean | 'horizontal' | 'vertical';
export function linkedStyleProperties(
  property: StyleProperty,
  linkage: StyleLinkage = false,
): StyleProperty[] {
  const family = property.startsWith('padding-')
    ? 'padding'
    : property.startsWith('margin-')
      ? 'margin'
      : null;
  if (!family || !linkage) return [property];
  const sides =
    linkage === 'horizontal'
      ? ['left', 'right']
      : linkage === 'vertical'
        ? ['top', 'bottom']
        : ['top', 'right', 'bottom', 'left'];
  return sides.map((side) => `${family}-${side}` as StyleProperty);
}
export type PreviewPreference = { enabled: boolean; disabledTargets: string[] };
export type StyleEditorState = {
  preview: boolean;
  previewMixed: boolean;
  globalPreview: boolean;
  globalCount: number;
  scopeCount: number;
  values: Record<string, string>;
  current: Record<string, string>;
  mixed: StyleProperty[];
  mixedOriginal: StyleProperty[];
  stepProperties: StyleProperty[];
  changes: StyleChange[];
  count: number;
  dirty: boolean;
  sharedMarkers: number;
  canUndo: boolean;
  canRedo: boolean;
  problem: 'missing' | 'changed' | null;
};

export function stepStyleValue(
  property: StyleProperty,
  value: string,
  direction: number,
  coarse: boolean,
) {
  const match = value.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
  if (!match) return null;
  const unit =
    match[2] || (['opacity', 'font-weight', 'line-height'].includes(property) ? '' : 'px');
  if (!CSS.supports(property, `${match[1]}${unit}`)) return null;
  const step =
    property === 'opacity' && unit !== '%'
      ? 0.05
      : ['em', 'rem'].includes(unit) || (property === 'line-height' && !unit)
        ? 0.1
        : 1;
  let next = Number(match[1]) + direction * step * (coarse ? 10 : 1);
  if (!Number.isFinite(next)) return null;
  if (!property.startsWith('margin-')) next = Math.max(0, next);
  if (property === 'opacity') next = Math.min(unit === '%' ? 100 : 1, next);
  return `${Number(next.toFixed(4))}${unit}`;
}

/** One page owns shared target styles. Markers only select editing scopes. */
export function createStyleEditor(
  resolve: (target: TargetSnapshot) => Element | null,
  notify = () => {},
) {
  let targets = new Map<string, TargetSnapshot>();
  let aliases = new Map<string, string>();
  let identities = new WeakMap<Element, string>();
  let committed: Revision = new Map();
  let drafts: Revision = new Map();
  let references = new Map<string, Set<string>>();
  let originals = new Map<string, Record<string, string>>();
  let scope: string[] = [];
  let scopeSnapshots: TargetSnapshot[] = [];
  let related = new Set<string>();
  let active = '';
  let selectedScope: string[] = [];
  let boundNodes = new Map<string, WeakRef<Element>>();
  let globalPreview = true;
  let disabled = new Set<string>();
  let confirmed = new Set<string>();
  let blocked = new Map<string, 'missing' | 'changed'>();
  let rejectedIdentity = new Set<string>();
  let suspended = false;
  let variantTargets = new Set<string>();
  let destroyed = false;
  const applied = new Map<string, InlineStylePreview>();
  let undo: Edit[] = [],
    redo: Edit[] = [];
  let captureDepth = 0;
  let lastDocument = '';
  const equalChanges = (a: StyleChange[], b: StyleChange[]) =>
    JSON.stringify(a) === JSON.stringify(b);
  const canonical = (id: string) => aliases.get(id) ?? id;
  const keyFor = (target: TargetSnapshot) =>
    aliases.get(target.id) ?? canonical(styleTargetKey(target));
  const editing = () =>
    active === '__selection__'
      ? selectedScope.filter((key) => scope.includes(key))
      : active
        ? [canonical(active)].filter((key) => scope.includes(key))
        : scope;
  const changes = (key: string) => drafts.get(key) ?? committed.get(key) ?? [];
  const styled = (key: string) => {
    const target = targets.get(key);
    const element = target && resolve(target);
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) return null;
    const known = boundNodes.get(key);
    if (known && known.deref() !== element) return null;
    if (!known) boundNodes.set(key, new WeakRef(element));
    return element;
  };
  const scopeAvailable = (key: string) => {
    const element = styled(key);
    return (
      !!element &&
      scopeSnapshots
        .filter((target) => keyFor(target) === key)
        .every((target) => canonical(styleTargetKey(target)) === key && resolve(target) === element)
    );
  };
  const observer = new MutationObserver(() => {
    if (reconcile()) notify();
    else watch();
  });

  function watch() {
    if (destroyed || suspended || !globalPreview || captureDepth) return;
    const waiting = [...blocked].some(
      ([key, problem]) => problem === 'missing' && !rejectedIdentity.has(key),
    );
    if (!applied.size && !waiting) return;
    const options: MutationObserverInit = waiting
      ? {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['hidden', 'open', 'class', 'style'],
        }
      : { subtree: true, childList: true };
    observer.observe(document, options);
    for (const [key, target] of targets) {
      const element = styled(key);
      let root = element?.getRootNode();
      while (root instanceof ShadowRoot) {
        observer.observe(root, options);
        root = root.host.getRootNode();
      }
      if (waiting && !element) {
        let context: Document | ShadowRoot = document;
        for (const selector of target.shadowHosts) {
          let hosts: NodeListOf<Element>;
          try {
            hosts = context.querySelectorAll(selector);
          } catch {
            break;
          }
          if (hosts.length !== 1 || !hosts[0]?.shadowRoot) break;
          context = hosts[0].shadowRoot;
          observer.observe(context, options);
        }
      }
    }
  }

  function restore() {
    // Capture/teardown can precede MutationObserver delivery. Inspect ownership
    // before disconnecting, otherwise a previous drift confirmation masks new writes.
    detectConflicts();
    observer.disconnect();
    for (const preview of applied.values()) restoreInlineStyles(preview);
    applied.clear();
  }
  function values(key: string) {
    let baseline = originals.get(key);
    if (!baseline) {
      const element = styled(key);
      if (!element) return {};
      const computed = getComputedStyle(element);
      baseline = Object.fromEntries(
        styleProperties.map((property) => [property, computed.getPropertyValue(property)]),
      );
      for (const change of changes(key)) baseline[change.property] = change.before;
      originals.set(key, baseline);
    }
    return baseline;
  }
  function register(next: TargetSnapshot[]) {
    for (const snapshot of [...next].sort(
      (a, b) => Number(!!a.styleTargetId) - Number(!!b.styleTargetId),
    )) {
      const element = resolve(snapshot);
      const requested = canonical(styleTargetKey(snapshot));
      const owner = targets.get(requested),
        ownerElement = owner && resolve(owner);
      if (element && ownerElement && ownerElement !== element) {
        const key = snapshot.id;
        const target = structuredClone(snapshot);
        delete target.styleTargetId;
        delete target.styleChanges;
        if (key !== requested) {
          targets.set(key, target);
          aliases.set(key, key);
          identities.set(element, key);
        }
        blocked.set(key, 'missing');
        rejectedIdentity.add(key);
        continue;
      }
      const key = (element && identities.get(element)) ?? requested;
      if (element) identities.set(element, key);
      aliases.set(snapshot.id, key);
      aliases.set(styleTargetKey(snapshot), key);
      const previous = targets.get(key);
      if (!previous || (!resolve(previous) && element)) {
        const target = structuredClone(snapshot);
        delete target.styleChanges;
        if (key !== target.id) target.styleTargetId = key;
        targets.set(key, target);
      }
    }
  }
  function apply() {
    restore();
    if (destroyed || suspended || !globalPreview || captureDepth) return;
    for (const [key, problem] of blocked)
      if (problem === 'missing' && !rejectedIdentity.has(key) && styled(key)) blocked.delete(key);
    // Read all baselines before writing any parent/child overrides.
    for (const key of targets.keys()) values(key);
    const usable: [string, StyledElement, StyleChange[]][] = [];
    for (const key of targets.keys()) {
      const list = changes(key);
      if (!list.length || disabled.has(key) || variantTargets.has(key)) continue;
      if (blocked.has(key)) continue;
      const element = styled(key);
      if (!element) {
        blocked.set(key, 'missing');
        continue;
      }
      const computed = getComputedStyle(element);
      if (
        list.some(
          (change) =>
            !StyleChangeSchema.safeParse(change).success ||
            !CSS.supports(change.property, change.value) ||
            (!confirmed.has(key) &&
              computed.getPropertyValue(change.property) !== change.before &&
              computed.getPropertyValue(change.property) !== change.value),
        )
      ) {
        blocked.set(key, 'changed');
        continue;
      }
      usable.push([key, element, list]);
    }
    for (const [key, element, list] of usable) {
      applied.set(key, applyInlineStyles(element, list));
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    }
    watch();
  }
  function detectConflicts() {
    let changed = false;
    for (const [key, entry] of applied) {
      const problem =
        styled(key) !== entry.element || !entry.element.isConnected
          ? 'missing'
          : inlineStylesChanged(entry)
            ? 'changed'
            : null;
      if (problem) {
        blocked.set(key, problem);
        confirmed.delete(key);
        changed = true;
      }
    }
    return changed;
  }
  function reconcile() {
    let changed = detectConflicts();
    for (const [key, problem] of blocked) {
      if (problem !== 'missing' || rejectedIdentity.has(key) || !styled(key)) continue;
      blocked.delete(key);
      changed = true;
    }
    if (changed) apply();
    return changed;
  }
  function capture<T>(read: () => T): T {
    if (!captureDepth) restore();
    captureDepth++;
    try {
      return read();
    } finally {
      captureDepth--;
      if (!captureDepth) apply();
    }
  }
  function setDraft(key: string, list: StyleChange[]) {
    if (equalChanges(list, committed.get(key) ?? [])) drafts.delete(key);
    else drafts.set(key, structuredClone(list));
  }
  function remember(before: Revision, after: Revision) {
    if ([...before].every(([key, list]) => equalChanges(list, after.get(key) ?? []))) return;
    undo.push({ before, after });
    if (undo.length > 80) undo.shift();
    redo = [];
    for (const [key, list] of after) setDraft(key, list);
  }
  function historyIndex(stack: Edit[], expected: 'before' | 'after') {
    const keys = editing();
    for (let index = stack.length - 1; index >= 0; index--) {
      const entry = stack[index]!;
      if (![...entry.after.keys()].some((key) => keys.includes(key))) continue;
      // Never undo an older shared batch over a newer edit on one of its members.
      return [...entry[expected]].every(([key, list]) => equalChanges(changes(key), list))
        ? index
        : -1;
    }
    return -1;
  }
  function project(list: TargetSnapshot[]) {
    return list.map((snapshot) => {
      const target = structuredClone(snapshot),
        key = keyFor(target);
      delete target.styleTargetId;
      if (key !== target.id) target.styleTargetId = key;
      delete target.styleChanges;
      if (changes(key).length || drafts.has(key))
        target.styleChanges = structuredClone(changes(key));
      return target;
    });
  }
  function sync(document: FeedbackDocument) {
    const next = normalizeSharedStyles(document);
    const fingerprint = JSON.stringify({
      annotations: next.annotations.map((annotation) => [annotation.id, annotation.targets]),
      targetStyles: next.targetStyles,
    });
    if (fingerprint === lastDocument) return;
    lastDocument = fingerprint;
    capture(() => {
      const previousCommitted = committed;
      committed = new Map();
      references = new Map();
      const annotations = [...next.annotations].sort((a, b) =>
        a.updatedAt.localeCompare(b.updatedAt),
      );
      register(annotations.flatMap((annotation) => annotation.targets));
      for (const annotation of annotations)
        for (const target of annotation.targets) {
          const key = keyFor(target);
          if (canonical(styleTargetKey(target)) === key)
            committed.set(key, [
              ...new Map(
                [
                  ...(committed.get(key) ?? []),
                  ...structuredClone(
                    next.targetStyles?.[styleTargetKey(target)] ?? target.styleChanges ?? [],
                  ),
                ].map((change) => [change.property, change]),
              ).values(),
            ]);
          if (!references.has(key)) references.set(key, new Set());
          references.get(key)!.add(annotation.id);
        }
      for (const [key, list] of drafts) {
        if (equalChanges(list, committed.get(key) ?? [])) drafts.delete(key);
        else if (previousCommitted.has(key) && !committed.has(key)) drafts.delete(key);
      }
      prune();
    });
  }
  function prune() {
    for (const [key, target] of targets) {
      if (references.has(key) || drafts.has(key) || related.has(key)) continue;
      const element = resolve(target);
      if (element) identities.delete(element);
      targets.delete(key);
      originals.delete(key);
      disabled.delete(key);
      confirmed.delete(key);
      blocked.delete(key);
      rejectedIdentity.delete(key);
      boundNodes.delete(key);
      for (const [id, value] of aliases) if (value === key) aliases.delete(id);
    }
  }
  function mutate(
    property: StyleProperty,
    desired: (key: string, property: StyleProperty) => string | null,
    linked: StyleLinkage,
  ) {
    return capture(() => {
      const keys = editing();
      if (!keys.length) return false;
      if (keys.some((key) => !scopeAvailable(key))) return false;
      const before: Revision = new Map(),
        after: Revision = new Map();
      for (const key of keys) {
        const element = styled(key);
        if (!element) {
          blocked.set(key, 'missing');
          return false;
        }
        if (blocked.has(key)) return false;
        const baseline = values(key),
          props = linkedStyleProperties(property, linked);
        const list = structuredClone(changes(key));
        before.set(key, list);
        const next = new Map(list.map((change) => [change.property, change]));
        const computed = getComputedStyle(element);
        for (const p of props) {
          const value = desired(key, p);
          if (value === null || !CSS.supports(p, value)) return false;
          const parsed = StyleChangeSchema.safeParse({
            property: p,
            before: baseline[p] ?? '',
            value,
          });
          if (!parsed.success) return false;
          if (
            !confirmed.has(key) &&
            computed.getPropertyValue(p) !== parsed.data.before &&
            computed.getPropertyValue(p) !== parsed.data.value
          ) {
            blocked.set(key, 'changed');
            return false;
          }
          if (parsed.data.value === parsed.data.before) next.delete(p);
          else next.set(p, parsed.data);
        }
        after.set(key, [...next.values()]);
      }
      remember(before, after);
      return true;
    });
  }

  return {
    reset(next: TargetSnapshot[] = []) {
      restore();
      targets = new Map();
      aliases = new Map();
      identities = new WeakMap();
      committed = new Map();
      drafts = new Map();
      references = new Map();
      originals = new Map();
      scope = [];
      related = new Set();
      scopeSnapshots = [];
      active = '';
      selectedScope = [];
      boundNodes = new Map();
      globalPreview = true;
      disabled = new Set();
      confirmed = new Set();
      blocked = new Map();
      rejectedIdentity = new Set();
      suspended = false;
      undo = [];
      redo = [];
      lastDocument = '';
      capture(() => {
        register(next);
        scopeSnapshots = structuredClone(next);
        scope = [...new Set(next.map(keyFor))];
        related = new Set(scope);
        for (const target of next)
          if (target.styleChanges?.length)
            committed.set(keyFor(target), structuredClone(target.styleChanges));
      });
    },
    sync,
    holdForVariants(ids: string[]) {
      const next = new Set(ids.map(canonical));
      if (next.size === variantTargets.size && [...next].every((id) => variantTargets.has(id)))
        return;
      variantTargets = next;
      apply();
    },
    register: (next: TargetSnapshot[]) => capture(() => register(next)),
    begin(next: TargetSnapshot[], retainRelated = false) {
      capture(() => {
        register(next);
        scopeSnapshots = structuredClone(next);
        scope = [...new Set(next.map(keyFor))];
        active = '';
        if (!retainRelated) related = new Set();
        for (const key of scope) related.add(key);
      });
    },
    clearScope() {
      scope = [];
      scopeSnapshots = [];
      related.clear();
      active = '';
      selectedScope = [];
      prune();
      apply();
    },
    capture,
    suspend: () => {
      suspended = true;
      restore();
    },
    resume: () => {
      suspended = false;
      apply();
    },
    destroy: () => {
      destroyed = true;
      suspended = true;
      restore();
    },
    reconcile,
    active: () => active,
    select(id: string) {
      active = id;
      capture(() => {
        for (const key of editing()) values(key);
      });
    },
    editingTargets: () =>
      scopeSnapshots
        .filter((target) => editing().includes(keyFor(target)))
        .map((target) => target.id),
    selectScope(ids: string[]) {
      const keys = [...new Set(ids.map(canonical).filter((key) => scope.includes(key)))];
      if (keys.length === scope.length) active = '';
      else if (keys.length === 1)
        active = scopeSnapshots.find((target) => keyFor(target) === keys[0])!.id;
      else if (keys.length > 1) {
        active = '__selection__';
        selectedScope = keys;
      } else active = scopeSnapshots[0]?.id ?? '';
    },
    global(value: boolean) {
      globalPreview = value;
      if (value) suspended = false;
      apply();
    },
    preference: (): PreviewPreference => ({
      enabled: globalPreview,
      disabledTargets: [...disabled],
    }),
    restorePreference(preference?: PreviewPreference) {
      globalPreview = preference?.enabled ?? true;
      disabled = new Set(preference?.disabledTargets ?? []);
    },
    preview(value: boolean, force = false) {
      if (destroyed || !globalPreview) return false;
      if (editing().some((key) => !scopeAvailable(key) || blocked.get(key) === 'missing'))
        return false;
      restore();
      if (value) suspended = false;
      for (const key of editing()) {
        if (value) disabled.delete(key);
        else disabled.add(key);
        if (force) {
          confirmed.add(key);
          blocked.delete(key);
        }
      }
      apply();
      return !editing().some((key) => blocked.has(key));
    },
    targets: () =>
      project(
        [...related]
          .map((key) => targets.get(key))
          .filter((target): target is TargetSnapshot => !!target),
      ),
    scopeTargets: () =>
      project(
        scopeSnapshots.filter(
          (target, index, all) =>
            all.findIndex((item) => keyFor(item) === keyFor(target)) === index,
        ),
      ),
    changedTargets: () =>
      project(
        [...related]
          .filter((key) => drafts.has(key) || changes(key).length)
          .map((key) => targets.get(key))
          .filter((target): target is TargetSnapshot => !!target),
      ),
    drafts: () =>
      project(
        [...drafts.keys()]
          .map((key) => targets.get(key))
          .filter((target): target is TargetSnapshot => !!target),
      ),
    loadDrafts(next: TargetSnapshot[]) {
      capture(() => {
        register(next);
        for (const target of next) setDraft(keyFor(target), target.styleChanges ?? []);
      });
    },
    links: () => Object.fromEntries([...aliases].filter(([id, key]) => id !== key)),
    cancel() {
      for (const key of related) drafts.delete(key);
      undo = undo.filter((entry) => ![...entry.after.keys()].some((key) => related.has(key)));
      redo = [];
      apply();
    },
    discardAll() {
      drafts.clear();
      undo = [];
      redo = [];
      scope = [];
      scopeSnapshots = [];
      related.clear();
      apply();
    },
    project,
    edit: (property: StyleProperty, value: string, linked: StyleLinkage = false) =>
      mutate(property, () => value, linked),
    step: (
      property: StyleProperty,
      direction: number,
      coarse: boolean,
      linked: StyleLinkage = false,
    ) =>
      mutate(
        property,
        (key, p) =>
          stepStyleValue(
            p,
            changes(key).find((change) => change.property === p)?.value ?? values(key)[p] ?? '',
            direction,
            coarse,
          ),
        linked,
      ),
    remove(property?: StyleProperty, linked: StyleLinkage = false) {
      const properties = property ? linkedStyleProperties(property, linked) : [];
      const before: Revision = new Map(),
        after: Revision = new Map();
      for (const key of editing()) {
        before.set(key, structuredClone(changes(key)));
        after.set(
          key,
          property ? changes(key).filter((change) => !properties.includes(change.property)) : [],
        );
      }
      remember(before, after);
      apply();
    },
    history(direction: 'undo' | 'redo') {
      const from = direction === 'undo' ? undo : redo,
        to = direction === 'undo' ? redo : undo;
      const index = historyIndex(from, direction === 'undo' ? 'after' : 'before');
      if (index < 0) return;
      const [entry] = from.splice(index, 1);
      to.push(entry!);
      for (const [key, list] of entry![direction === 'undo' ? 'before' : 'after'])
        setDraft(key, list);
      apply();
    },
    state(): StyleEditorState {
      const keys = editing(),
        baseline: Record<string, string> = {},
        current: Record<string, string> = {},
        mixed: StyleProperty[] = [],
        mixedOriginal: StyleProperty[] = [],
        stepProperties: StyleProperty[] = [];
      const modified = new Map<StyleProperty, StyleChange>();
      for (const key of keys)
        for (const change of changes(key)) modified.set(change.property, change);
      for (const property of styleProperties) {
        const before = keys.map((key) => values(key)[property] ?? '');
        const next = keys.map(
          (key) =>
            changes(key).find((change) => change.property === property)?.value ??
            values(key)[property] ??
            '',
        );
        if (new Set(before).size > 1) mixedOriginal.push(property);
        else baseline[property] = before[0] ?? '';
        if (new Set(next).size > 1) mixed.push(property);
        else current[property] = next[0] ?? '';
        if (
          next.length &&
          next.every((value) => stepStyleValue(property, value, 1, false) !== null)
        )
          stepProperties.push(property);
      }
      const participating = keys.filter((key) => !disabled.has(key)).length;
      return {
        preview: keys.length > 0 && participating === keys.length,
        previewMixed: participating > 0 && participating < keys.length,
        globalPreview,
        globalCount: [...targets.keys()].reduce((n, key) => n + changes(key).length, 0),
        scopeCount: keys.length,
        values: baseline,
        current,
        mixed,
        mixedOriginal,
        stepProperties,
        changes: [...modified.values()],
        count: [...related].reduce((n, key) => n + changes(key).length, 0),
        dirty: [...related].some((key) => drafts.has(key)),
        sharedMarkers: Math.max(0, ...keys.map((key) => references.get(key)?.size ?? 0)),
        canUndo: historyIndex(undo, 'after') >= 0,
        canRedo: historyIndex(redo, 'before') >= 0,
        problem: keys.some((key) => !scopeAvailable(key) || blocked.get(key) === 'missing')
          ? 'missing'
          : keys.some((key) => blocked.get(key) === 'changed')
            ? 'changed'
            : null,
      };
    },
  };
}
