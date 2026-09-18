import { css, html, nothing } from 'lit';
import { ChevronRight, Undo2, Redo2, Columns2, SquareDashed, createElement } from 'lucide';
import { StyleValueSchema, type StyleProperty } from '@ainotation/schema';
import { messages } from '../i18n';
import type { InspectorAction, InspectorViewState } from '../core/types';
import { linkedStyleProperties, type StyleLinkage } from '../core/style-editor';

const icon = (value: typeof ChevronRight) =>
  createElement(value, { 'aria-hidden': 'true', focusable: 'false' });
const groups = [
  ['styleSize', ['width', 'height']],
  ['styleText', ['font-size', 'line-height', 'font-weight', 'text-align', 'color']],
  [
    'styleAppearance',
    ['background-color', 'border-color', 'border-width', 'border-radius', 'opacity'],
  ],
  ['styleLayout', ['display', 'gap', 'flex-direction', 'align-items', 'justify-content']],
] as const;
const choices: Partial<Record<StyleProperty, string[]>> = {
  'font-weight': ['400', '500', '600', '700'],
  'text-align': ['left', 'center', 'right'],
  display: ['block', 'inline-block', 'flex', 'grid', 'inline-flex'],
  'flex-direction': ['row', 'column', 'row-reverse', 'column-reverse'],
  'align-items': ['normal', 'stretch', 'flex-start', 'center', 'flex-end'],
  'justify-content': [
    'normal',
    'flex-start',
    'center',
    'flex-end',
    'space-between',
    'space-around',
  ],
};
const hex = (value: string) => {
  if (/^#[\da-f]{6}$/i.test(value)) return value;
  const match = value.match(/^rgb\(\s*(\d+)[, ]+\s*(\d+)[, ]+\s*(\d+)\s*\)$/);
  return match
    ? `#${match
        .slice(1)
        .map((n) => Number(n).toString(16).padStart(2, '0'))
        .join('')}`
    : null;
};
const unitless = ['opacity', 'font-weight', 'line-height'];
function normalized(property: StyleProperty, value: string) {
  value = value.trim();
  return /^-?(?:\d+\.?\d*|\.\d+)$/.test(value) && !unitless.includes(property)
    ? `${value}px`
    : value;
}
type SpacingFamily = 'padding' | 'margin';
type SpacingMode = 'all' | 'axes' | 'sides';
const readLinkage = (element: HTMLElement): StyleLinkage =>
  element.dataset.styleLink === 'all'
    ? true
    : element.dataset.styleLink === 'horizontal'
      ? 'horizontal'
      : element.dataset.styleLink === 'vertical'
        ? 'vertical'
        : false;

export const stylePanelStyles = css`
  .editor-tabs {
    display: flex;
    gap: 4px;
    border-bottom: 1px solid var(--ain-border);
    margin: 0 0 10px;
  }
  .editor-tabs button {
    padding: 2px 8px;
    border: 0;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    font-size: 12px;
    color: var(--ain-muted);
  }
  .editor-tabs button[aria-selected='true'] {
    border-bottom-color: var(--ain-accent);
    color: var(--ain-text);
  }
  .style-count {
    padding: 0 4px;
    border-radius: 3px;
    background: var(--ain-surface-muted);
    font-size: 10px;
    margin-left: 4px;
  }
  .style-preview {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 0 8px;
    border-bottom: 1px solid var(--ain-border);
  }
  .style-preview label {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    font-size: 11px;
  }
  .style-preview input {
    accent-color: var(--ain-focus);
  }
  .style-preview button {
    border: 0;
    padding: 4px;
    width: 24px;
    height: 24px;
    background: transparent;
  }
  .style-preview svg {
    width: 16px;
    height: 16px;
  }
  .style-scroll {
    max-height: min(390px, 45vh);
    overflow: auto;
    overscroll-behavior: contain;
    overflow-anchor: none;
    border-bottom: 1px solid var(--ain-border);
    scrollbar-width: thin;
  }
  .style-group {
    border-bottom: 1px solid var(--ain-border);
  }
  .style-group:last-child {
    border-bottom: 0;
  }
  .style-group summary {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 0 10px 4px;
    font-size: 12px;
    cursor: pointer;
    list-style: none;
  }
  .style-chevron {
    display: inline-flex;
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
  }
  .style-chevron svg {
    width: 14px;
    height: 14px;
  }
  .style-group[open] .style-chevron {
    transform: rotate(90deg);
  }
  .style-fields {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 12px 10px;
    padding-bottom: 12px;
  }
  .style-field {
    min-width: 0;
  }
  .style-label {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 23px;
    font-size: 10px;
    color: var(--ain-muted);
  }
  .style-label .style-reset {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: 0;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    background: transparent;
  }
  .style-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ain-accent);
  }
  .style-input {
    display: flex;
    align-items: center;
    border: 1px solid var(--ain-field-border);
    border-radius: 4px;
    background: var(--ain-field);
  }
  .style-input input[type='text'],
  .style-input select {
    width: 100%;
    min-width: 0;
    border: 0;
    padding: 7px 8px;
    background: transparent;
    color: var(--ain-text);
    font: 12px system-ui;
  }
  .style-input input[type='color'] {
    width: 26px;
    min-width: 26px;
    height: 27px;
    padding: 2px;
    margin-left: 4px;
    border: 0;
    background: none;
  }
  .style-input:focus-within {
    outline: 2px solid var(--ain-focus);
    outline-offset: -2px;
  }
  .style-input input:focus,
  .style-input select:focus {
    outline: 0;
  }
  .style-input select option {
    background: var(--ain-field);
  }
  .style-before {
    display: block;
    font:
      10px/1.4 ui-monospace,
      monospace;
    color: var(--ain-muted);
    margin-top: 4px;
    overflow-wrap: anywhere;
  }
  .style-invalid {
    color: var(--ain-error);
    font-size: 10px;
  }
  .style-restore {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: var(--ain-muted);
    font-size: 10px;
  }
  .style-restore button {
    font-size: 10px;
    padding: 3px 5px;
  }
  .style-spacing {
    padding: 12px 0;
    border-top: 1px solid var(--ain-border);
  }
  .spacing-main {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    align-items: start;
  }
  .spacing-modes {
    display: flex;
    gap: 4px;
    padding-top: 23px;
  }
  .spacing-modes button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 32px;
    padding: 4px;
    border-radius: 4px;
    background: var(--ain-field);
  }
  .spacing-modes button[aria-pressed='true'] {
    background: var(--ain-selected);
    border-color: var(--ain-focus);
  }
  .spacing-modes svg {
    width: 16px;
    height: 16px;
  }
  .spacing-details {
    padding: 8px 0 0;
  }
  .style-restore {
    margin-top: 8px;
  }
  .style-target {
    width: 100%;
    margin: 0 0 8px;
    padding: 5px;
    background: var(--ain-field);
    color: var(--ain-text);
    border: 1px solid var(--ain-field-border);
    font: 11px system-ui;
  }
  .style-problem,
  .style-note {
    margin: 8px 0;
    color: var(--ain-muted);
    font-size: 11px;
  }
`;

export function createStylePanel(
  getView: () => InspectorViewState | null,
  onAction: (action: InspectorAction) => void,
  refresh: () => void,
) {
  let raw = new Map<string, string>();
  let invalid = new Set<string>();
  const spacingModes: Record<SpacingFamily, SpacingMode> = { padding: 'all', margin: 'all' };
  const expanded = new Set<string>(['styleSize']);
  const scopeKey = () =>
    `${getView()
      ?.styleTargets.map((target) => target.styleTargetId ?? target.id)
      .join(',')}:${getView()?.styleTargetId}:`;
  const keyFor = (property: StyleProperty, linked: StyleLinkage = false) =>
    `${scopeKey()}${linkedStyleProperties(property, linked).join('|')}`;
  const clearOverlapping = (properties: StyleProperty[]) => {
    for (const key of new Set([...raw.keys(), ...invalid])) {
      if (
        key.startsWith(scopeKey()) &&
        key
          .slice(scopeKey().length)
          .split('|')
          .some((p) => properties.includes(p as StyleProperty))
      ) {
        raw.delete(key);
        invalid.delete(key);
      }
    }
  };
  const emitStep = (
    property: StyleProperty,
    direction: number,
    coarse: boolean,
    linked: StyleLinkage,
  ) => {
    clearOverlapping(linkedStyleProperties(property, linked));
    onAction({ type: 'style-step', property, direction, coarse, linked });
  };
  const emitValue = (property: StyleProperty, value: string, linked: StyleLinkage) => {
    const key = keyFor(property, linked),
      properties = linkedStyleProperties(property, linked);
    clearOverlapping(properties);
    raw.set(key, value);
    const next = normalized(property, value);
    if (
      !StyleValueSchema.safeParse(next).success ||
      properties.some((p) => !CSS.supports(p, next))
    ) {
      invalid.add(key);
      refresh();
      return;
    }
    invalid.delete(key);
    onAction({ type: 'style-change', property, value: next, linked });
  };
  return {
    reset() {
      raw = new Map();
      invalid = new Set();
      spacingModes.padding = 'all';
      spacingModes.margin = 'all';
    },
    invalid: () => invalid.size > 0,
    tabs(view: InspectorViewState) {
      const m = messages(view.locale);
      return html`<div class="editor-tabs" role="tablist" aria-label=${m.editFeedback}>
        ${(['feedback', 'styles'] as const).map((tab) => html`<button id=${`ain-${tab}-tab`} role="tab" data-action="editor-tab" data-tab=${tab} aria-controls=${`ain-${tab}-panel`} aria-selected=${String(view.editorTab === tab)} tabindex=${view.editorTab === tab ? 0 : -1}>${tab === 'feedback' ? m.styleFeedbackTab : m.styleStylesTab}${tab === 'styles' && view.styleEditor.count ? html`<span class="style-count">${view.styleEditor.count}</span>` : nothing}</button>`)}
      </div>`;
    },
    body(view: InspectorViewState) {
      const m = messages(view.locale),
        state = view.styleEditor;
      const field = (
        property: StyleProperty,
        linked: StyleLinkage = false,
        fieldLabel = m.styleProperty(property),
        fieldId = `style-${property}`,
      ) => {
        const properties = linkedStyleProperties(property, linked);
        const originalMixed =
          properties.some((p) => state.mixedOriginal.includes(p)) ||
          new Set(properties.map((p) => state.values[p] ?? '')).size > 1;
        const mixed =
          properties.some((p) => state.mixed.includes(p)) ||
          new Set(properties.map((p) => state.current[p] ?? '')).size > 1;
        const original = originalMixed ? m.styleMixed : (state.values[property] ?? ''),
          change = state.changes.find((change) => properties.includes(change.property)),
          color = property.includes('color');
        const key = keyFor(property, linked),
          value =
            raw.get(key) ??
            (mixed
              ? ''
              : color
                ? (hex(state.current[property] ?? '') ?? state.current[property] ?? '')
                : (state.current[property] ?? ''));
        const choicesFor = choices[property];
        return html`<div class="style-field">
          <div class="style-label">
            <label for=${fieldId}>${fieldLabel}</label
            >${change || invalid.has(key) ? html`<button class="style-reset" data-action="style-reset" data-property=${property} data-style-link=${linked === true ? 'all' : linked || 'none'} data-field-id=${fieldId} aria-label=${`${m.styleReset}: ${fieldLabel}`} title=${m.styleBefore(original)}><span class="style-dot" aria-hidden="true"></span></button>` : nothing}
          </div>
          <div class="style-input">
            ${color ? html`<input type="color" aria-label=${`${m.color}: ${m.styleProperty(property)}`} data-style-property=${property} .value=${hex(value) ?? '#000000'} ?disabled=${view.saving || !!state.problem} />` : nothing}
            ${
              choicesFor
                ? html`<select
                    id=${fieldId}
                    data-style-property=${property}
                    ?disabled=${view.saving || !!state.problem}
                  >
                    ${state.mixed.includes(property) ? html`<option value="" .selected=${value === ''} disabled>${m.styleMixed}</option>` : nothing}
                    ${[...new Set([...(state.mixedOriginal.includes(property) ? [] : [original]), ...choicesFor, value])].filter(Boolean).map((choice) => html`<option value=${choice} .selected=${choice === value}>${choice}</option>`)}
                  </select>`
                : html`<input
                    id=${fieldId}
                    type="text"
                    ?disabled=${view.saving || !!state.problem}
                    data-style-property=${property}
                    data-style-link=${linked === true ? 'all' : linked || 'none'}
                    data-numeric=${color ? 'false' : 'true'}
                    .value=${value}
                    placeholder=${mixed ? m.styleMixed : nothing}
                    aria-invalid=${String(invalid.has(key))}
                    title=${color ? nothing : m.styleNumericHint}
                    autocomplete="off"
                    spellcheck="false"
                  />`
            }
          </div>
          ${invalid.has(key) ? html`<span class="style-invalid" role="alert">${m.styleInvalid}</span>` : change ? html`<span class="style-before">${m.styleBefore(original)}</span>` : nothing}
        </div>`;
      };
      const spacing = (family: SpacingFamily) => {
        const label = family === 'padding' ? m.stylePadding : m.styleMargin,
          mode = spacingModes[family];
        const property = (side: string) => `${family}-${side}` as StyleProperty;
        return html`<section class="style-spacing" aria-label=${label}>
          <div class="spacing-main">
            ${field(property('top'), true, label, `style-${family}-all`)}
            <div class="spacing-modes" role="group" aria-label=${`${label}: ${m.styleSpacingMode}`}>
              <button
                type="button"
                data-action="style-spacing-mode"
                data-family=${family}
                data-mode="axes"
                aria-label=${`${label}: ${m.styleSpacingAxes}`}
                title=${`${m.styleSpacingAxes} · ${m.styleSpacingToggleHint}`}
                aria-pressed=${String(mode === 'axes')}
                ?disabled=${view.saving}
              >
                ${icon(Columns2)}
              </button>
              <button
                type="button"
                data-action="style-spacing-mode"
                data-family=${family}
                data-mode="sides"
                aria-label=${`${label}: ${m.styleSpacingSides}`}
                title=${`${m.styleSpacingSides} · ${m.styleSpacingToggleHint}`}
                aria-pressed=${String(mode === 'sides')}
                ?disabled=${view.saving}
              >
                ${icon(SquareDashed)}
              </button>
            </div>
          </div>
          ${
            mode === 'all'
              ? nothing
              : html`<div class="style-fields spacing-details">
                  ${mode === 'axes' ? html`${field(property('left'), 'horizontal', `${label}: ${m.styleSpacingHorizontal}`, `style-${family}-horizontal`)}${field(property('top'), 'vertical', `${label}: ${m.styleSpacingVertical}`, `style-${family}-vertical`)}` : linkedStyleProperties(property('top'), true).map((p) => field(p))}
                </div>`
          }
        </section>`;
      };
      return html`<div id="ain-styles-panel" role="tabpanel" aria-labelledby="ain-styles-tab">
        ${
          view.styleTargets.length > 1
            ? html`<select
                class="style-target"
                aria-label=${m.styleTarget}
                data-action="style-target"
              >
                <option value="" .selected=${view.styleTargetId === ''}>
                  ${m.styleAllTargets(view.styleTargets.length)}
                </option>
                ${view.styleTargetId === '__selection__' ? html`<option value="__selection__" .selected=${true}>${m.styleSelectedTargets(state.scopeCount)}</option>` : nothing}
                ${view.styleTargets.map((target) => html`<option value=${target.id} .selected=${view.styleTargetId === target.id}>${target.label || target.tagName} — ${target.selector}</option>`)}
              </select>`
            : nothing
        }
        <div class="style-preview">
          <label
            ><input
              type="checkbox"
              data-action="style-preview"
              .checked=${state.preview}
              .indeterminate=${state.previewMixed}
              ?disabled=${!state.globalPreview || state.problem === 'missing'}
            />${state.scopeCount > 1 ? m.stylePreviewMany(state.scopeCount) : m.stylePreview}</label
          ><button
            data-action="style-undo"
            aria-label=${m.undo}
            title=${m.undo}
            ?disabled=${!state.canUndo}
          >
            ${icon(Undo2)}</button
          ><button
            data-action="style-redo"
            aria-label=${m.redo}
            title=${m.redo}
            ?disabled=${!state.canRedo}
          >
            ${icon(Redo2)}
          </button>
        </div>
        ${!state.globalPreview ? html`<p class="style-problem">${m.styleGlobalOff}</p>` : nothing}
        ${state.sharedMarkers > 1 ? html`<p class="style-note">${m.styleShared(state.sharedMarkers)}</p>` : nothing}
        ${
          state.problem
            ? html`<p class="style-problem" role="status">
                  ${state.problem === 'missing' ? m.styleMissing : m.styleChanged}
                </p>
                ${state.problem === 'changed' ? html`<button data-action="style-force" ?disabled=${!state.globalPreview}>${m.styleForcePreview}</button>` : nothing}`
            : nothing
        }
        <div class="style-scroll">
          ${groups.map(
            ([group, properties]) =>
              html`<details class="style-group" .open=${expanded.has(group)}>
                <summary data-style-group=${group}>
                  <span class="style-chevron">${icon(ChevronRight)}</span>${m[group]}
                </summary>
                <div class="style-fields">${properties.map((property) => field(property))}</div>
                ${group === 'styleSize' ? html`${spacing('padding')}${spacing('margin')}` : nothing}
              </details>`,
          )}
        </div>
        <div class="style-restore">
          <button data-action="style-reset" ?disabled=${!state.count && !invalid.size}>
            ${m.styleResetAll}</button
          ><span>${m.styleCount(state.count)}</span>
        </div>
      </div>`;
    },
    handle(event: Event, target: Element) {
      const view = getView();
      if (!view) return false;
      const input =
        target instanceof HTMLInputElement || target instanceof HTMLSelectElement ? target : null;
      const property = input?.dataset.styleProperty as StyleProperty | undefined;
      const linked = input ? readLinkage(input) : false;
      if (
        property &&
        ((event.type === 'input' && input instanceof HTMLInputElement) ||
          (event.type === 'change' && input instanceof HTMLSelectElement))
      ) {
        if (!view.saving) {
          const value = input!.value;
          if (input instanceof HTMLSelectElement)
            input.value = view.styleEditor.current[property] ?? '';
          emitValue(property, value, linked);
        }
        return true;
      }
      if (property && event.type === 'blur') {
        const key = keyFor(property, linked);
        if (!invalid.has(key) && raw.delete(key)) {
          // Blur may be dispatched synchronously while Lit removes the panel.
          // Never re-enter rendering before that removal has completed.
          queueMicrotask(refresh);
        }
        return true;
      }
      if (
        property &&
        input instanceof HTMLInputElement &&
        input.dataset.numeric === 'true' &&
        !view.saving
      ) {
        if (event instanceof WheelEvent) {
          if (
            (input.getRootNode() instanceof ShadowRoot &&
              (input.getRootNode() as ShadowRoot).activeElement !== input) ||
            event.ctrlKey ||
            event.metaKey
          )
            return true;
          const r = input.getBoundingClientRect();
          if (
            event.clientX < r.left ||
            event.clientX >= r.right ||
            event.clientY < r.top ||
            event.clientY >= r.bottom
          )
            return true;
          const delta =
            event.shiftKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)
              ? event.deltaX
              : event.deltaY;
          if (!delta || (!event.shiftKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)))
            return true;
          if (
            linkedStyleProperties(property, linked).every((p) =>
              view.styleEditor.stepProperties.includes(p),
            ) &&
            !invalid.has(keyFor(property, linked))
          ) {
            event.preventDefault();
            emitStep(property, delta < 0 ? 1 : -1, event.shiftKey, linked);
          }
          return true;
        }
        if (
          event instanceof KeyboardEvent &&
          event.type === 'keydown' &&
          ['ArrowUp', 'ArrowDown'].includes(event.key)
        ) {
          if (
            linkedStyleProperties(property, linked).every((p) =>
              view.styleEditor.stepProperties.includes(p),
            ) &&
            !invalid.has(keyFor(property, linked))
          ) {
            event.preventDefault();
            emitStep(property, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey, linked);
          }
          return true;
        }
      }
      if (event.type === 'change' && input?.dataset.action === 'style-preview') {
        const value = (input as HTMLInputElement).checked;
        (input as HTMLInputElement).checked = view.styleEditor.preview;
        onAction({ type: 'style-preview', value });
        return true;
      }
      if (event.type === 'change' && input?.dataset.action === 'style-target') {
        onAction({ type: 'style-target', id: input.value });
        return true;
      }
      if (event.type === 'click' && target.closest<HTMLElement>('[data-style-group]')) {
        event.preventDefault();
        const group = target.closest<HTMLElement>('[data-style-group]')!.dataset.styleGroup!;
        if (expanded.has(group)) expanded.delete(group);
        else expanded.add(group);
        refresh();
        return true;
      }
      const button = target.closest<HTMLButtonElement>('button');
      if (
        event instanceof KeyboardEvent &&
        event.type === 'keydown' &&
        button?.dataset.action === 'editor-tab' &&
        ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
      ) {
        event.preventDefault();
        const tab =
          event.key === 'Home'
            ? 'feedback'
            : event.key === 'End'
              ? 'styles'
              : view.editorTab === 'feedback'
                ? 'styles'
                : 'feedback';
        const root = button.getRootNode() as ShadowRoot;
        onAction({ type: 'editor-tab', value: tab });
        root.querySelector<HTMLElement>(`#ain-${tab}-tab`)?.focus();
        return true;
      }
      if (event.type !== 'click' || !button || button.disabled) return false;
      const action = button.dataset.action;
      if (action === 'editor-tab') {
        onAction({ type: 'editor-tab', value: button.dataset.tab as 'feedback' | 'styles' });
        return true;
      }
      if (!action?.startsWith('style-')) return false;
      if (view.saving) return true;
      if (action === 'style-spacing-mode') {
        const family = button.dataset.family as SpacingFamily,
          mode = button.dataset.mode as SpacingMode;
        clearOverlapping(linkedStyleProperties(`${family}-top`, true));
        spacingModes[family] = spacingModes[family] === mode ? 'all' : mode;
        refresh();
      } else if (action === 'style-force')
        onAction({ type: 'style-preview', value: true, force: true });
      else if (action === 'style-undo' || action === 'style-redo') {
        raw.clear();
        invalid.clear();
        onAction({ type: 'style-history', direction: action === 'style-undo' ? 'undo' : 'redo' });
      } else if (action === 'style-reset') {
        const root = button.getRootNode() as ShadowRoot;
        const p = button.dataset.property as StyleProperty | undefined;
        const linkage = readLinkage(button);
        if (p) {
          clearOverlapping(linkedStyleProperties(p, linkage));
        } else {
          raw.clear();
          invalid.clear();
        }
        onAction(
          p ? { type: 'style-reset', property: p, linked: linkage } : { type: 'style-reset' },
        );
        if (p)
          root
            .getElementById(button.dataset.fieldId ?? `style-${p}`)
            ?.focus({ preventScroll: true });
      }
      return true;
    },
  };
}
