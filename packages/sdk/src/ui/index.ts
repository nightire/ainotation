import { LitElement, css, html, nothing, type PropertyValues } from 'lit';
import { Copy, createElement, Download, Settings, Trash2, X, Sun, Moon } from 'lucide';
import { themeStyles } from './theme';
import {
  TRIGGER_SIZE,
  TOOLBAR_WIDTH,
  TOOLBAR_HEIGHT,
  getViewport,
  clampPoint,
  triggerAnchor,
  positionFromAnchor,
  expandToolbar,
} from './position';

import {
  emptyViewState,
  outputDetails,
  type InspectorAction,
  type InspectorViewState,
  type InspectorPosition,
} from '../core/types';

function icon(node: Parameters<typeof createElement>[0]) {
  return createElement(node, { 'aria-hidden': 'true', focusable: 'false' });
}

export class InspectorShell extends LitElement {
  static override properties = {
    view: { attribute: false },
    expanded: { type: Boolean, reflect: true },
    endpointDraft: { state: true },
    token: { state: true },
    settingsOpen: { state: true },
  };

  static override styles = css`
    ${themeStyles}
    :host {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: block;
      box-sizing: border-box;
      width: ${TRIGGER_SIZE}px;
      height: ${TRIGGER_SIZE}px;
      color: var(--ain-text);
      font:
        13px/1.5 system-ui,
        sans-serif;
      letter-spacing: 0;
      color-scheme: var(--ain-scheme);
    }
    :host([expanded]) {
      width: ${TOOLBAR_WIDTH}px;
      height: ${TOOLBAR_HEIGHT}px;
      max-width: min(calc(100vw - 32px), calc(var(--inspector-viewport-width, 100vw) - 32px));
    }
    * {
      box-sizing: border-box;
    }
    [hidden],
    .toolbar[hidden] {
      display: none !important;
    }
    .toolbar {
      display: flex;
      height: ${TOOLBAR_HEIGHT}px;
      border: 1px solid var(--ain-border);
      border-radius: 999px;
      background: var(--ain-surface);
      color: var(--ain-text);
      box-shadow: 0 6px 24px var(--ain-shadow);
    }
    header,
    .row,
    .actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    header {
      width: 100%;
      border-radius: inherit;
      padding: 5px 8px;
      gap: 4px;
      cursor: grab;
      touch-action: none;
      user-select: none;
    }
    h2,
    p {
      margin: 0;
    }
    h2 {
      font-size: 15px;
      font-weight: 650;
    }
    .row,
    .actions {
      flex-wrap: wrap;
    }
    .muted {
      color: var(--ain-muted);
      font-size: 12px;
    }
    button,
    input {
      font: inherit;
    }
    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      min-height: 32px;
      padding: 5px 9px;
      border: 1px solid var(--ain-border);
      border-radius: 4px;
      background: var(--ain-surface);
      color: var(--ain-text);
      cursor: pointer;
    }
    button:hover:not(:disabled) {
      background: var(--ain-hover);
    }
    button:disabled {
      opacity: 0.45;
      cursor: default;
    }
    button.primary {
      background: var(--ain-accent);
      border-color: var(--ain-accent);
      color: var(--ain-on-accent);
    }
    button.primary:hover:not(:disabled) {
      background: var(--ain-accent-hover);
    }
    .launcher {
      display: flex;
      width: ${TRIGGER_SIZE}px;
      height: ${TRIGGER_SIZE}px;
      padding: 0;
      border-radius: 50%;
      font-size: 20px;
      font-weight: 650;
      touch-action: none;
      user-select: none;
      box-shadow: 0 4px 20px var(--ain-shadow);
    }
    .icon {
      width: 40px;
      height: 40px;
      min-width: 0;
      flex: 1 1 40px;
      padding: 8px;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: inherit;
    }
    .icon:hover:not(:disabled),
    .icon[aria-expanded='true'] {
      background: var(--ain-hover);
    }
    .icon svg {
      width: 19px;
      height: 19px;
    }
    .separator {
      width: 1px;
      height: 22px;
      background: var(--ain-border);
      margin: 0 5px;
      flex-shrink: 0;
    }
    .settings {
      position: absolute;
      bottom: calc(100% + 10px);
      right: 0;
      width: 300px;
      max-width: calc(100vw - 24px);
      padding: 16px;
      border: 1px solid var(--ain-border);
      border-radius: 14px;
      background: var(--ain-surface);
      box-shadow: 0 8px 32px var(--ain-shadow);
      overflow: auto;
      overscroll-behavior: contain;
    }
    .settings-heading {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .connection-status {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--ain-muted);
    }
    .connection-status::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--ain-idle);
    }
    .connection-status[data-state='connected']::before {
      background: var(--ain-accent);
    }
    .connection-status[data-state='error']::before {
      background: var(--ain-error);
    }
    .toolbar:focus-within {
      border-color: var(--ain-accent);
    }
    .notices:empty {
      display: none;
    }
    .notices {
      position: absolute;
      right: 0;
      bottom: calc(100% + 10px);
      width: max-content;
      max-width: min(300px, calc(100vw - 32px));
      padding: 8px 12px;
      border: 1px solid var(--ain-border);
      border-radius: 10px;
      background: var(--ain-surface);
      box-shadow: 0 4px 16px var(--ain-shadow);
      pointer-events: none;
    }
    .toolbar .icon:focus-visible {
      outline-color: var(--ain-accent);
    }
    @media (prefers-reduced-motion: no-preference) {
      .icon {
        transition: background 120ms;
      }
    }
    button:focus-visible,
    header:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--ain-accent);
      outline-offset: 2px;
    }
    svg {
      width: 16px;
      height: 16px;
      flex-shrink: 0;
    }
    label {
      display: grid;
      gap: 5px;
    }
    input {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--ain-field-border);
      border-radius: 4px;
      padding: 7px 8px;
      background: var(--ain-field);
      color: var(--ain-text);
    }
    input::placeholder {
      color: var(--ain-muted);
      opacity: 1;
    }
    .connection-form {
      display: grid;
      gap: 9px;
      padding-top: 4px;
    }
    .output-detail {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin: 4px 0;
    }
    .detail-label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      color: var(--ain-muted);
    }
    .detail-choice {
      display: inline-flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      min-width: 104px;
      height: 28px;
      min-height: 28px;
      max-height: 28px;
      font-weight: 650;
      color: inherit;
      background: transparent;
      border: 0;
      border-radius: 4px;
      padding: 4px;
    }
    .detail-dots {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 4px;
      gap: 2px;
    }
    .detail-dot {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.25;
    }
    .detail-dot.active {
      width: 4px;
      height: 4px;
      opacity: 1;
    }
    .detail-description {
      font-size: 12px;
      color: var(--ain-muted);
      margin: 0 0 16px;
    }
    .notices {
      display: grid;
      gap: 3px;
      margin-top: 7px;
      overflow-wrap: anywhere;
      font-size: 12px;
    }
    .message {
      color: var(--ain-message);
    }
  `;

  declare view: InspectorViewState;
  declare expanded: boolean;
  declare private endpointDraft: string | null;
  declare private token: string;
  declare settingsOpen: boolean;

  // Both shapes share the toolbar edge occupied by the trigger.
  private opensLeft = true;
  private hasPosition = false;
  private positionMoved = false;
  private drag: {
    target: HTMLElement;
    pointerId: number;
    x: number;
    y: number;
    left: number;
    top: number;
    dragged: boolean;
    deferredCapture: boolean;
  } | null = null;
  private listeners: AbortController | undefined;
  private resizeObserver: ResizeObserver | undefined;
  private frame = 0;
  private suppressClick = false;
  private suppressTimer: ReturnType<typeof setTimeout> | undefined;
  private focusExpanded: boolean | undefined;

  constructor() {
    super();
    this.view = emptyViewState();
    this.expanded = false;
    this.endpointDraft = null;
    this.token = '';
    this.settingsOpen = false;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    if (!this.hasAttribute('data-ainotation-ui')) {
      this.setAttribute('data-ainotation-ui', 'inspector');
    }
    this.listeners = new AbortController();
    const { signal } = this.listeners;
    this.addEventListener('pointerdown', this.clearSuppressedClick, { capture: true, signal });
    this.addEventListener('keydown', this.clearSuppressedClick, { capture: true, signal });
    this.addEventListener('click', this.onClickCapture, { capture: true, signal });
    this.addEventListener('pointermove', this.onPointerMove, { signal });
    this.addEventListener('pointerup', this.onPointerEnd, { signal });
    this.addEventListener('pointercancel', this.onPointerEnd, { signal });
    this.addEventListener('lostpointercapture', this.onPointerEnd, { signal });
    this.ownerDocument.addEventListener('keydown', this.onShortcut, { capture: true, signal });
    this.ownerDocument.addEventListener('pointerdown', this.onOutsidePointer, {
      capture: true,
      signal,
    });
    window.addEventListener('resize', this.scheduleClamp, { signal });
    window.visualViewport?.addEventListener('resize', this.scheduleClamp, { signal });
    window.visualViewport?.addEventListener('scroll', this.scheduleClamp, { signal });
    this.resizeObserver = new ResizeObserver(this.scheduleClamp);
    this.resizeObserver.observe(this);
    this.scheduleClamp();
  }

  override disconnectedCallback(): void {
    this.listeners?.abort();
    this.listeners = undefined;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.finishDrag();
    this.clearSuppressedClick();
    this.focusExpanded = undefined;
    super.disconnectedCallback();
  }

  protected override willUpdate(changed: PropertyValues<this>): void {
    this.dataset.theme = this.view.theme;
    if (!changed.has('expanded') || !this.hasUpdated) return;
    if (!this.expanded) this.settingsOpen = false;
    this.finishDrag();
    const rect = this.getBoundingClientRect();
    if (this.expanded) {
      const placement = expandToolbar(rect, this.opensLeft, getViewport());
      this.opensLeft = placement.opensLeft;
      this.setPosition(placement.point);
    } else {
      this.setPosition(triggerAnchor(rect, true, this.opensLeft));
    }
  }

  protected override updated(): void {
    if (!this.isConnected) return;
    this.clampPosition();
    if (this.focusExpanded === this.expanded) {
      const selector = this.expanded ? 'button[aria-label="Close inspector"]' : '.launcher';
      this.renderRoot.querySelector<HTMLButtonElement>(selector)?.focus({ preventScroll: true });
    }
    this.focusExpanded = undefined;
  }

  private expand(value: boolean): void {
    this.focusExpanded = value;
    this.expanded = value;
    this.onaction({ type: 'set-picking', value });
  }

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    if (this.settingsOpen)
      void this.updateComplete.then(() => {
        if (this.settingsOpen && this.expanded)
          this.renderRoot.querySelector<HTMLElement>('.settings')?.focus({ preventScroll: true });
      });
  }

  private onOutsidePointer = (event: PointerEvent): void => {
    if (this.settingsOpen && !event.composedPath().includes(this)) this.settingsOpen = false;
  };

  private positionSettings(): void {
    const popover = this.renderRoot.querySelector<HTMLElement>('.settings');
    if (!popover || !this.settingsOpen || !this.expanded) return;
    const { left, top, width, height } = getViewport();
    const rect = this.getBoundingClientRect();
    const size = Math.min(300, Math.max(0, width - 24));
    popover.style.width = `${size}px`;
    popover.style.left = `${Math.max(left + 12, Math.min(rect.right - size, left + width - size - 12)) - rect.left}px`;
    popover.style.right = 'auto';
    const above = rect.top - top - 20;
    const below = top + height - rect.bottom - 20;
    const opensBelow = above < popover.scrollHeight + 2 && below > above;
    popover.style.top = opensBelow ? 'calc(100% + 10px)' : 'auto';
    popover.style.bottom = opensBelow ? 'auto' : 'calc(100% + 10px)';
    popover.style.maxHeight = `${Math.max(0, opensBelow ? below : above)}px`;
  }

  private onShortcut = (event: KeyboardEvent): void => {
    const owner = event.composedPath().find((node) => node instanceof InspectorShell);
    if (owner && owner !== this) return;
    if (
      !event.defaultPrevented &&
      this.expanded &&
      this.settingsOpen &&
      event.key === 'Escape' &&
      !event.altKey &&
      !event.isComposing
    ) {
      event.preventDefault();
      event.stopImmediatePropagation();
      this.settingsOpen = false;
      this.renderRoot
        .querySelector<HTMLButtonElement>('[aria-label="Settings"]')
        ?.focus({ preventScroll: true });
      return;
    }
    // Firefox on macOS also reports Option as AltGraph; match altKey directly.
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.repeat ||
      event.code !== 'KeyA' ||
      !event.altKey ||
      !event.shiftKey ||
      event.ctrlKey ||
      event.metaKey ||
      (!this.expanded && this.view.storage === 'loading')
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    this.clearSuppressedClick();
    this.expand(!this.expanded);
  };

  private setPosition({ left, top }: { left: number; top: number }): void {
    this.style.left = `${left}px`;
    this.style.top = `${top}px`;
    this.style.right = 'auto';
    this.style.bottom = 'auto';
  }

  getPosition(): InspectorPosition | undefined {
    if (!this.isConnected || !this.hasPosition) return;
    const rect = this.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    return triggerAnchor(rect, this.hasAttribute('expanded'), this.opensLeft);
  }

  restorePosition(position: InspectorPosition): void {
    if (!this.isConnected || this.positionMoved) return;
    this.hasPosition = true;
    this.opensLeft = position.opensLeft;
    const rect = this.getBoundingClientRect();
    this.setPosition(positionFromAnchor(position, rect, this.hasAttribute('expanded')));
    this.clampPosition();
  }

  private notifyPosition(): void {
    if (this.getPosition()) this.dispatchEvent(new CustomEvent('ainotation-position-change'));
  }

  private clampPosition(position?: { left: number; top: number }): void {
    if (position) {
      this.positionMoved = true;
      this.hasPosition = true;
    }
    const viewport = getViewport();
    const { width, height } = viewport;
    this.style.setProperty('--inspector-viewport-width', `${width}px`);
    this.style.setProperty('--inspector-viewport-height', `${height}px`);
    const rect = this.getBoundingClientRect();
    const { left, top } = clampPoint(position ?? rect, rect, viewport);
    if (position || left !== rect.left || top !== rect.top) this.setPosition({ left, top });
    // A newly moved trigger chooses its opening direction again. Toolbar movement
    // keeps the current edge so closing and reopening do not jump sideways.
    if (!this.expanded && position) this.opensLeft = true;
    this.positionSettings();
    if (!position && (left !== rect.left || top !== rect.top)) this.notifyPosition();
  }

  private scheduleClamp = (): void => {
    if (!this.isConnected || this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (this.isConnected && this.hasUpdated) this.clampPosition();
    });
  };

  private clearSuppressedClick = (): void => {
    this.suppressClick = false;
    clearTimeout(this.suppressTimer);
    this.suppressTimer = undefined;
  };

  private onClickCapture = (event: MouseEvent): void => {
    // Keyboard and assistive-technology activation must still work after a drag.
    if (!this.suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.clearSuppressedClick();
  };

  private onPointerDown = (event: PointerEvent): void => {
    if (this.drag || !event.isPrimary || event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    const fromControl =
      target.localName === 'header' &&
      event
        .composedPath()
        .some(
          (node) =>
            node instanceof Element &&
            node !== target &&
            node.matches('button, input, textarea, select, details, a, [contenteditable]'),
        );
    if (fromControl && event.pointerType !== 'touch') return;
    const { left, top } = this.getBoundingClientRect();
    this.drag = {
      target,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left,
      top,
      dragged: false,
      deferredCapture: fromControl,
    };
    if (!fromControl) target.setPointerCapture(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (!drag.dragged && Math.hypot(dx, dy) < 5) return;
    if (drag.deferredCapture) {
      drag.deferredCapture = false;
      drag.target.setPointerCapture(event.pointerId);
    }
    drag.dragged = true;
    event.preventDefault();
    this.clampPosition({ left: drag.left + dx, top: drag.top + dy });
  };

  private onPointerEnd = (event: PointerEvent): void => {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.type === 'lostpointercapture' && event.composedPath()[0] !== drag.target) return;
    if (event.type === 'pointerup') this.onPointerMove(event);
    if (drag.dragged || event.type !== 'pointerup') {
      this.suppressClick = true;
      this.suppressTimer = setTimeout(this.clearSuppressedClick, 500);
    }
    if (drag.dragged) this.notifyPosition();
    this.finishDrag();
  };

  private finishDrag(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.target.hasPointerCapture(drag.pointerId)) {
      drag.target.releasePointerCapture(drag.pointerId);
    }
  }

  private onMoveKey = (event: KeyboardEvent): void => {
    if (
      event.composedPath()[0] !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    const step = event.shiftKey ? 1 : 10;
    const movement: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = movement[event.key];
    if (!delta) {
      if (event.key === ' ' && (event.currentTarget as HTMLElement).localName === 'header')
        event.preventDefault();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const { left, top } = this.getBoundingClientRect();
    this.clampPosition({ left: left + delta[0], top: top + delta[1] });
    this.notifyPosition();
  };

  private onaction(detail: InspectorAction): void {
    this.dispatchEvent(
      new CustomEvent<InspectorAction>('ainotation-action', {
        detail,
        bubbles: true,
        composed: true,
      }),
    );
  }

  override render() {
    const view = this.view;
    const detailIndex = Math.max(
      0,
      outputDetails.findIndex((detail) => detail.value === view.outputDetail),
    );
    const currentDetail = outputDetails[detailIndex]!;
    const nextDetail = outputDetails[(detailIndex + 1) % outputDetails.length]!;
    const endpoint = this.endpointDraft ?? view.endpoint;
    const connectionLabel = {
      offline: 'Offline',
      connecting: 'Connecting',
      connected: 'Connected',
      error: 'Error',
    }[view.connection];
    const notices = html`
      ${view.storage === 'loading' ? html`<p>Loading local feedback...</p>` : nothing}
      ${view.storage === 'unavailable' ? html`<p>Local storage unavailable. Changes are not saved locally.</p>` : nothing}
      ${view.syncing ? html`<p>Syncing feedback...</p>` : nothing}
      ${view.message ? html`<p class="message">${view.message}</p>` : nothing}
    `;
    return html`
      <button
        class="launcher primary"
        type="button"
        aria-label="Open inspector"
        title="Open inspector (Option/Alt + Shift + A)"
        aria-keyshortcuts="Alt+Shift+A"
        aria-expanded=${this.expanded}
        aria-controls="inspector-toolbar"
        ?hidden=${this.expanded}
        ?disabled=${view.storage === 'loading'}
        aria-busy=${view.storage === 'loading'}
        @pointerdown=${this.onPointerDown}
        @keydown=${this.onMoveKey}
        @click=${() => this.expand(true)}
      >
        A
      </button>
      <section
        id="inspector-toolbar"
        class="toolbar"
        role="toolbar"
        aria-label="Ainotation inspector"
        ?hidden=${!this.expanded}
      >
        <header
          role="group"
          tabindex="0"
          aria-label="Move inspector"
          @pointerdown=${this.onPointerDown}
          @keydown=${this.onMoveKey}
        >
          <button
            class="icon"
            type="button"
            aria-label="Copy feedback"
            title="Copy feedback from all pages in this project"
            ?disabled=${!view.document}
            @click=${() => this.onaction({ type: 'copy' })}
          >
            ${icon(Copy)}
          </button>
          <button
            class="icon"
            type="button"
            aria-label="Export JSON"
            title="Export JSON for this page"
            ?disabled=${!view.document}
            @click=${() => this.onaction({ type: 'export' })}
          >
            ${icon(Download)}
          </button>
          <button
            class="icon"
            type="button"
            aria-label="Clear all annotations"
            title="Clear all annotations on this page"
            ?disabled=${view.saving || view.storage === 'loading' || (!view.document?.annotations.length && !view.selected.length && !view.draft)}
            @click=${() => this.onaction({ type: 'clear-all' })}
          >
            ${icon(Trash2)}
          </button>
          <button
            class="icon"
            type="button"
            aria-label="Settings"
            title="Settings"
            aria-expanded=${this.settingsOpen}
            aria-controls="inspector-settings"
            aria-haspopup="dialog"
            @click=${() => this.toggleSettings()}
          >
            ${icon(Settings)}
          </button>
          <span class="separator" role="separator" aria-orientation="vertical"></span>
          <button
            class="icon"
            type="button"
            aria-label="Close inspector"
            title="Close inspector (Option/Alt + Shift + A)"
            aria-keyshortcuts="Alt+Shift+A"
            @click=${() => this.expand(false)}
          >
            ${icon(X)}
          </button>
        </header>
      </section>
      <section
        class="settings"
        id="inspector-settings"
        role="dialog"
        aria-label="Inspector settings"
        tabindex="-1"
        ?hidden=${!this.expanded || !this.settingsOpen}
      >
        <div class="settings-heading">
          <h2>Settings</h2>
          <span class="connection-status" data-state=${view.connection} role="status"
            >${connectionLabel}</span
          >
        </div>
        <div class="output-detail">
          <label class="detail-label" for="inspector-theme">Theme</label>
          <button
            id="inspector-theme"
            class="detail-choice"
            type="button"
            aria-label=${`Theme: ${view.theme === 'dark' ? 'Dark' : 'Light'}`}
            title=${`Switch to ${view.theme === 'dark' ? 'light' : 'dark'} mode`}
            @click=${() => this.onaction({ type: 'set-theme', value: view.theme === 'dark' ? 'light' : 'dark' })}
          >
            <span>${view.theme === 'dark' ? 'Dark' : 'Light'}</span
            >${icon(view.theme === 'dark' ? Moon : Sun)}
          </button>
        </div>
        <div class="output-detail">
          <label class="detail-label" for="output-detail">Output Detail</label>
          <button
            class="detail-choice"
            type="button"
            id="output-detail"
            data-level=${currentDetail.value}
            aria-label=${`Output Detail: ${currentDetail.label}`}
            title=${`Switch to ${nextDetail.label}`}
            aria-describedby="output-detail-description"
            @click=${() => this.onaction({ type: 'set-output-detail', value: nextDetail.value })}
          >
            <span>${currentDetail.label}</span>
            <span class="detail-dots" aria-hidden="true"
              >${outputDetails.map((detail) => html`<span class=${`detail-dot${detail.value === currentDetail.value ? ' active' : ''}`}></span>`)}</span
            >
          </button>
        </div>
        <p class="detail-description" id="output-detail-description">
          ${outputDetails.find((detail) => detail.value === view.outputDetail)?.description} Applies
          to copied Markdown.
        </p>
        <p>MCP connection</p>
        <p class="muted">
          ${view.connection === 'connected' ? 'Feedback sync is connected to the local MCP server.' : 'Local feedback is available. Connect a local MCP server to share it with your agent.'}
        </p>
        <form
          class="connection-form"
          @submit=${(event: SubmitEvent) => {
            event.preventDefault();
            if (
              !endpoint.trim() ||
              !this.token.trim() ||
              view.connection === 'connecting' ||
              view.connection === 'connected'
            )
              return;
            const token = this.token.trim();
            this.token = '';
            this.onaction({ type: 'connect', endpoint: endpoint.trim(), token });
          }}
        >
          <label
            >Endpoint<input
              type="url"
              required
              .value=${endpoint}
              placeholder="http://127.0.0.1:4748"
              @input=${(event: Event) => {
                this.endpointDraft = (event.currentTarget as HTMLInputElement).value;
              }}
          /></label>
          <label
            >Token<input
              type="password"
              autocomplete="off"
              .value=${this.token}
              @input=${(event: Event) => {
                this.token = (event.currentTarget as HTMLInputElement).value;
              }}
          /></label>
          <div class="row">
            <button
              type="submit"
              ?disabled=${view.storage === 'loading' || !endpoint.trim() || !this.token.trim() || view.connection === 'connecting' || view.connection === 'connected'}
            >
              Connect
            </button>
            ${
              view.connection !== 'offline'
                ? html`
                    <button type="button" @click=${() => this.onaction({ type: 'disconnect' })}>
                      Disconnect
                    </button>
                  `
                : nothing
            }
          </div>
        </form>
      </section>
      <div
        class="notices"
        role="status"
        ?hidden=${!this.expanded || this.settingsOpen || (view.storage === 'ready' && !view.syncing && !view.message)}
      >
        ${notices}
      </div>
    `;
  }
}

export function registerInspectorShell(): void {
  if (!customElements.get('ainotation-inspector-shell')) {
    customElements.define('ainotation-inspector-shell', InspectorShell);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'ainotation-inspector-shell': InspectorShell;
  }
}
