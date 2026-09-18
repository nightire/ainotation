import { LitElement, html, nothing } from 'lit';
import { live } from 'lit/directives/live.js';
import {
  Camera,
  ImagePlus,
  Copy,
  Check,
  X,
  Trash2,
  Download,
  GripVertical,
  ArrowUp,
  ArrowDown,
  Undo2,
  Redo2,
  ChevronRight,
  createElement,
} from 'lucide';
import { themeStyles } from '../../../packages/sdk/src/ui/theme';
import { colorHex, fields, groups, targets, type Changes, type Field } from './style-editor-model';
import { prototypeStyles } from './style-editor-styles';
import { PrototypeImages, type PrototypeImage } from './style-editor-images';

const icon = (value: typeof Camera) =>
  createElement(value, { 'aria-hidden': 'true', focusable: 'false' });

type Original = { value: string; priority: string; computed: string };
type Saved = { comment: string; targetId: string; changes: Changes; images: PrototypeImage[] };

export class StyleEditorPrototype extends LitElement {
  static styles = [themeStyles, prototypeStyles];
  initialTab: 'feedback' | 'styles' = 'feedback';
  multiple = false;
  private tab: 'feedback' | 'styles' = 'feedback';
  private active = 'prototype-cta';
  private opened = true;
  private preview = true;
  private comment = '';
  private changes: Changes = {};
  private saved: Saved | null = null;
  private originals = new Map<string, Record<string, Original>>();
  private elements = new Map<string, HTMLElement>();
  private undo: Changes[] = [];
  private redo: Changes[] = [];
  private raw: Record<string, string> = {};
  private errors: Record<string, string> = {};
  private linked = false;
  private expanded = new Set(['size']);
  private previous: string | null = null;
  private notice = '';
  private images: PrototypeImage[] = [];
  private panelMessage = '';
  private draggingFile = false;
  private attachments = new PrototypeImages({
    getImages: () => this.images,
    setImages: (images) => {
      this.images = images;
      this.retainImages();
      this.requestUpdate();
    },
    theme: () => (this.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'),
    changed: () => {
      if (this.attachments.busy) (this.shadowRoot?.activeElement as HTMLElement | null)?.blur();
      this.requestUpdate();
      if (!this.attachments.busy && this.isConnected)
        void this.updateComplete.then(() =>
          this.renderRoot
            .querySelector<HTMLTextAreaElement>('textarea')
            ?.focus({ preventScroll: true }),
        );
    },
    message: (message) => {
      this.panelMessage = message;
    },
  });
  private lifetime = new AbortController();
  private position: { x: number; y: number } | null = null;
  private drag: { id: number; x: number; y: number; left: number; top: number } | null = null;

  connectedCallback() {
    super.connectedCallback();
    this.lifetime = new AbortController();
    // Register before the scroll container: Chrome's compositor can dispatch
    // non-cancelable wheel events when the blocker lives only on a ShadowRoot.
    window.addEventListener('wheel', (event) => this.adjustWithWheel(event), {
      capture: true,
      passive: false,
      signal: this.lifetime.signal,
    });
    window.addEventListener(
      'resize',
      () => {
        this.position = null;
        this.requestUpdate();
      },
      { signal: this.lifetime.signal },
    );
  }

  firstUpdated() {
    this.tab = this.initialTab;
    for (const target of targets) {
      const element = this.renderRoot.querySelector<HTMLElement>(`#${target.id}`)!;
      this.elements.set(target.id, element);
      const computed = getComputedStyle(element);
      this.originals.set(
        target.id,
        Object.fromEntries(
          fields.map(({ property }) => [
            property,
            {
              value: element.style.getPropertyValue(property),
              priority: element.style.getPropertyPriority(property),
              computed: computed.getPropertyValue(property),
            },
          ]),
        ),
      );
    }
    this.requestUpdate();
    void this.updateComplete.then(() => {
      if (this.tab === 'feedback')
        this.renderRoot
          .querySelector<HTMLTextAreaElement>('textarea')
          ?.focus({ preventScroll: true });
    });
  }

  updated() {
    this.applyPreview();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.lifetime.abort();
    this.attachments.destroy();
    this.restore();
  }

  private restore() {
    for (const [id, originals] of this.originals) {
      const element = this.elements.get(id)!;
      for (const [property, original] of Object.entries(originals)) {
        if (original.value) element.style.setProperty(property, original.value, original.priority);
        else element.style.removeProperty(property);
      }
    }
  }

  private applyPreview() {
    this.restore();
    if (this.opened && this.preview) {
      for (const [id, changes] of Object.entries(this.changes)) {
        for (const [property, value] of Object.entries(changes)) {
          this.elements.get(id)?.style.setProperty(property, value);
        }
      }
    }
    const panel = this.renderRoot.querySelector<HTMLElement>('.panel');
    if (panel && this.position && window.innerWidth > 820) {
      panel.style.left = `${this.position.x}px`;
      panel.style.top = `${this.position.y}px`;
    } else if (panel) {
      panel.style.removeProperty('left');
      panel.style.removeProperty('top');
    }
    const marker = this.renderRoot.querySelector<HTMLElement>('.target-marker');
    const selected = this.elements.get(this.active);
    const card = this.elements.get('prototype-card');
    if (marker && selected && card) {
      const targetRect = selected.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      marker.style.left = `${targetRect.right - cardRect.left - 13}px`;
      marker.style.top = `${targetRect.top - cardRect.top - 13}px`;
      marker.style.right = 'auto';
    }
  }

  private count(changes = this.changes) {
    return Object.values(changes).reduce((total, values) => total + Object.keys(values).length, 0);
  }

  private remember() {
    this.undo.push(structuredClone(this.changes));
    if (this.undo.length > 80) this.undo.shift();
    this.redo = [];
  }

  private change(property: string, raw: string) {
    const key = `${this.active}:${property}`;
    this.raw[key] = raw;
    const value =
      /^-?(?:\d+\.?\d*|\.\d+)$/.test(raw.trim()) &&
      !['opacity', 'font-weight', 'line-height'].includes(property)
        ? `${raw.trim()}px`
        : raw.trim();
    // Keep this prototype to literal property values. Custom properties and
    // external resources require a deliberate policy before production use.
    if (value && (!CSS.supports(property, value) || /url\(|var\(|[;{}]/i.test(value))) {
      this.errors[key] = '请输入有效的 CSS 值';
      this.requestUpdate();
      return;
    }
    delete this.errors[key];
    this.remember();
    const properties =
      this.linked && property.startsWith('padding-')
        ? fields
            .filter((field) => field.property.startsWith('padding-'))
            .map((field) => field.property)
        : [property];
    const changes = { ...this.changes[this.active] };
    for (const item of properties) {
      const before = this.originals.get(this.active)?.[item]?.computed;
      if (
        !value ||
        value === before ||
        (item.includes('color') && colorHex(value) === colorHex(before ?? '') && colorHex(value))
      )
        delete changes[item];
      else changes[item] = value;
      if (item !== property) {
        delete this.raw[`${this.active}:${item}`];
        delete this.errors[`${this.active}:${item}`];
      }
    }
    this.changes = { ...this.changes, [this.active]: changes };
    this.requestUpdate();
  }

  private resetField(property: string) {
    this.remember();
    delete this.changes[this.active]?.[property];
    delete this.raw[`${this.active}:${property}`];
    delete this.errors[`${this.active}:${property}`];
    this.requestUpdate();
  }

  private history(direction: 'undo' | 'redo') {
    const from = direction === 'undo' ? this.undo : this.redo;
    const to = direction === 'undo' ? this.redo : this.undo;
    const next = from.pop();
    if (!next) return;
    to.push(structuredClone(this.changes));
    this.changes = next;
    this.raw = {};
    this.errors = {};
    this.requestUpdate();
  }

  private select(id: string) {
    if (!this.opened) this.reopen();
    this.active = id;
    this.previous = null;
    if (id === 'prototype-title') this.expanded.add('text');
    this.requestUpdate();
  }

  private reopen() {
    this.opened = true;
    this.active = this.saved?.targetId ?? 'prototype-cta';
    this.previous = null;
    this.changes = structuredClone(this.saved?.changes ?? {});
    this.comment = this.saved?.comment ?? '';
    this.images = [...(this.saved?.images ?? [])];
    this.panelMessage = '';
    this.retainImages();
    this.preview = !this.saved;
    this.undo = [];
    this.redo = [];
    this.raw = {};
    this.errors = {};
    this.notice = this.saved ? '已打开保存的建议。开启“预览修改”可再次查看效果。' : '';
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.renderRoot
        .querySelector<HTMLTextAreaElement>('textarea')
        ?.focus({ preventScroll: true }),
    );
  }

  private close(save: boolean) {
    if (save)
      this.saved = {
        comment: this.comment.trim(),
        targetId: this.active,
        changes: structuredClone(this.changes),
        images: [...this.images],
      };
    this.opened = false;
    this.preview = false;
    this.raw = {};
    this.errors = {};
    this.images = [...(this.saved?.images ?? [])];
    this.retainImages();
    this.notice = save
      ? this.count()
        ? '标注已保存，页面预览已还原。'
        : '标注已保存。'
      : '已取消本次编辑。';
    this.restore();
    this.requestUpdate();
    void this.updateComplete.then(() =>
      this.renderRoot.querySelector<HTMLButtonElement>('#open-editor')?.focus(),
    );
  }

  private retainImages() {
    this.attachments.retain([...this.images, ...(this.saved?.images ?? [])]);
  }

  private canSave() {
    return (
      !!(this.comment.trim() || this.count() || this.images.length) &&
      !Object.keys(this.errors).length &&
      !this.attachments.busy
    );
  }

  private importImage(file?: File) {
    if (!file || this.attachments.busy) return;
    this.panelMessage = '';
    this.attachments.choose(file);
  }

  private async copySelector() {
    const selector = `#${this.active}`;
    try {
      await navigator.clipboard.writeText(selector);
      if (!this.isConnected) return;
      this.panelMessage = '选择符已复制。';
    } catch {
      const code = this.renderRoot.querySelector('.target-locator code');
      if (code) {
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      this.panelMessage = '请选中上方选择符并使用复制快捷键。';
    }
    this.requestUpdate();
  }

  private imageList(images = this.images, editable = true) {
    if (!images.length) return nothing;
    return html`<div class="images" aria-label="图片附件">
      ${images.map(
        (image, index) => html`<div class="image">
          ${editable ? html`<button class="image-preview" aria-label=${`编辑图片 ${index + 1}`} title="编辑图片" @click=${() => this.attachments.choose(image.blob, image.metadata.id)}><img src=${image.url} alt=${`附件 ${index + 1}`} /></button>` : html`<img src=${image.url} alt=${`附件 ${index + 1}`} />`}
          <button
            class="image-action image-download"
            aria-label=${`下载图片 ${index + 1}`}
            title="下载图片"
            @click=${() => {
              const link = document.createElement('a');
              link.href = image.url;
              link.download = `annotation-${index + 1}.png`;
              link.click();
            }}
          >
            ${icon(Download)}
          </button>
          ${
            editable
              ? html`<button
                  class="image-action image-remove"
                  aria-label=${`移除图片 ${index + 1}`}
                  title="移除图片"
                  @click=${() => {
                    this.images = this.images.filter((item) => item !== image);
                    this.retainImages();
                    this.requestUpdate();
                  }}
                >
                  ${icon(Trash2)}
                </button>`
              : nothing
          }
        </div>`,
      )}
    </div>`;
  }

  private deleteSaved() {
    this.saved = null;
    this.images = [];
    this.changes = {};
    this.comment = '';
    this.close(false);
    this.notice = '标注已删除。';
    this.requestUpdate();
  }

  private startDrag(event: PointerEvent) {
    if (event.button !== 0 || window.innerWidth <= 820) return;
    const handle = event.currentTarget as HTMLElement;
    const panel = this.renderRoot.querySelector<HTMLElement>('.panel')!;
    const workspace = this.renderRoot.querySelector<HTMLElement>('.workspace')!;
    const rect = panel.getBoundingClientRect();
    const parent = workspace.getBoundingClientRect();
    this.drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: rect.left - parent.left,
      top: rect.top - parent.top,
    };
    handle.setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private movePanel(x: number, y: number) {
    const panel = this.renderRoot.querySelector<HTMLElement>('.panel')!;
    const workspace = this.renderRoot.querySelector<HTMLElement>('.workspace')!;
    this.position = {
      x: Math.max(0, Math.min(workspace.clientWidth - panel.offsetWidth, x)),
      y: Math.max(0, Math.min(Math.max(0, workspace.clientHeight - panel.offsetHeight), y)),
    };
    this.requestUpdate();
  }

  private steppedValue(property: string, current: string, direction: number, coarse: boolean) {
    const match = current.trim().match(/^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i);
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
    let value = Number(match[1]) + direction * step * (coarse ? 10 : 1);
    if (!Number.isFinite(value)) return null;
    if (!property.startsWith('margin-')) value = Math.max(0, value);
    if (property === 'opacity') value = Math.min(unit === '%' ? 100 : 1, value);
    return `${Number(value.toFixed(4))}${unit}`;
  }

  private adjustWithWheel(event: WheelEvent) {
    const input = event.composedPath().find((node) => node instanceof HTMLInputElement);
    if (
      !(input instanceof HTMLInputElement) ||
      !input.dataset.numericProperty ||
      this.shadowRoot?.activeElement !== input ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    // Shift+wheel may arrive as horizontal deltas, depending on browser/device.
    const delta =
      event.shiftKey && Math.abs(event.deltaX) > Math.abs(event.deltaY)
        ? event.deltaX
        : event.deltaY;
    if (!delta || (!event.shiftKey && Math.abs(event.deltaX) > Math.abs(event.deltaY))) return;
    const rect = input.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX >= rect.right ||
      event.clientY < rect.top ||
      event.clientY >= rect.bottom
    )
      return;
    const property = input.dataset.numericProperty;
    const value = this.steppedValue(property, input.value, delta < 0 ? 1 : -1, event.shiftKey);
    if (value === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (value !== input.value) this.change(property, value);
  }

  private field(field: Field) {
    const { property, label, options, color } = field;
    const original = this.originals.get(this.active)?.[property]?.computed ?? '';
    const change = this.changes[this.active]?.[property];
    const key = `${this.active}:${property}`;
    const value = this.raw[key] ?? change ?? (color ? (colorHex(original) ?? original) : original);
    const error = this.errors[key];
    const fieldId = `field-${property}`;
    return html`<div class="field ${change ? 'changed' : ''}">
      <div class="field-label">
        <label for=${fieldId}>${label}</label>${
          change || error
            ? html`<button
                class="reset-dot"
                title=${`恢复原值：${original}`}
                aria-label=${`恢复${label}`}
                @click=${() => {
                  this.resetField(property);
                  void this.updateComplete.then(() =>
                    this.renderRoot
                      .querySelector<HTMLElement>(`#${fieldId}`)
                      ?.focus({ preventScroll: true }),
                  );
                }}
              >
                <span class="dot" aria-hidden="true"></span>
              </button>`
            : nothing
        }
      </div>
      <div class="input-row">
        ${color ? html`<input type="color" aria-label=${`选择${label}`} .value=${live(colorHex(value) ?? '#000000')} @input=${(event: Event) => this.change(property, (event.target as HTMLInputElement).value)} />` : nothing}
        ${
          options
            ? html`<select
                id=${fieldId}
                .value=${live(value)}
                @change=${(event: Event) => this.change(property, (event.target as HTMLSelectElement).value)}
              >
                ${[...new Set([original, ...options])].filter(Boolean).map((item) => html`<option value=${item}>${item}</option>`)}
              </select>`
            : html`<input
                id=${fieldId}
                type="text"
                data-numeric-property=${color ? nothing : property}
                title=${color ? nothing : '聚焦后可用滚轮或 ↑ ↓ 微调，Shift 加速'}
                autocomplete="off"
                spellcheck="false"
                .value=${live(value)}
                aria-invalid=${String(!!error)}
                @input=${(event: Event) => this.change(property, (event.target as HTMLInputElement).value)}
                @blur=${() => {
                  if (!error) {
                    delete this.raw[key];
                    this.requestUpdate();
                  }
                }}
                @keydown=${(event: KeyboardEvent) => {
                  if (!['ArrowUp', 'ArrowDown'].includes(event.key) || color) return;
                  const next = this.steppedValue(
                    property,
                    (event.currentTarget as HTMLInputElement).value,
                    event.key === 'ArrowUp' ? 1 : -1,
                    event.shiftKey,
                  );
                  if (next === null) return;
                  event.preventDefault();
                  this.change(property, next);
                }}
              />`
        }
      </div>
      ${error ? html`<span class="field-error" role="alert">${error}</span>` : change ? html`<span class="before" title=${`原值：${original}`}>原值 ${original}</span>` : nothing}
    </div>`;
  }

  private stylePanel() {
    return html`<div class="preview-row">
        <label class="toggle"
          ><input
            type="checkbox"
            .checked=${live(this.preview)}
            @change=${(event: Event) => {
              this.preview = (event.target as HTMLInputElement).checked;
              this.requestUpdate();
            }}
          />
          <span>预览修改</span></label
        >
        <button
          class="icon"
          aria-label="撤销样式修改"
          title="撤销"
          ?disabled=${!this.undo.length}
          @click=${() => this.history('undo')}
        >
          ${icon(Undo2)}
        </button>
        <button
          class="icon"
          aria-label="重做样式修改"
          title="重做"
          ?disabled=${!this.redo.length}
          @click=${() => this.history('redo')}
        >
          ${icon(Redo2)}
        </button>
      </div>
      <div class="panel-body" id="styles-panel" role="tabpanel" aria-labelledby="styles-tab">
        ${groups.map((group) => {
          const count = fields.filter(
            (field) => field.group === group.id && this.changes[this.active]?.[field.property],
          ).length;
          return html`<details
            class="section"
            .open=${this.expanded.has(group.id)}
            @toggle=${(event: Event) => {
              if ((event.target as HTMLDetailsElement).open) this.expanded.add(group.id);
              else this.expanded.delete(group.id);
            }}
          >
            <summary>
              <span class="section-chevron">${icon(ChevronRight)}</span>
              ${group.label}${count ? html`<span class="pill">${count}</span>` : nothing}
            </summary>
            <div class="fields">
              ${fields
                .filter((field) => field.group === group.id)
                .map(
                  (field) => html`
                    ${
                      field.property === 'padding-top'
                        ? html`<div class="linked-row">
                            <span>内边距 · 支持 px / rem / %</span
                            ><button
                              aria-pressed=${String(this.linked)}
                              @click=${() => {
                                this.linked = !this.linked;
                                this.requestUpdate();
                              }}
                            >
                              ${this.linked ? '四边联动' : '独立编辑'}
                            </button>
                          </div>`
                        : nothing
                    }
                    ${this.field(field)}
                  `,
                )}
            </div>
          </details>`;
        })}
      </div>`;
  }

  private output() {
    if (!this.saved) return null;
    return {
      comment: this.saved.comment,
      images: this.saved.images.map((image) => image.metadata),
      targets: targets
        .filter(
          (target) =>
            target.id === this.saved!.targetId ||
            Object.keys(this.saved!.changes[target.id] ?? {}).length,
        )
        .map((target) => ({
          selector: `#${target.id}`,
          styleChanges: Object.entries(this.saved!.changes[target.id] ?? {}).map(
            ([property, value]) => ({
              property,
              before: this.originals.get(target.id)?.[property]?.computed,
              value,
            }),
          ),
        })),
    };
  }

  private setTab(tab: 'feedback' | 'styles') {
    this.tab = tab;
    this.requestUpdate();
  }

  render() {
    const target = targets.find((item) => item.id === this.active)!;
    const count = this.count();
    const output = this.output();
    return html`<div class="prototype">
      <header class="topbar">
        <div class="row">
          <span class="wordmark">Ainotation</span><span class="badge">INTERACTION LAB</span>
        </div>
        <div class="top-actions">
          <button
            @click=${() => {
              this.restore();
              this.setAttribute(
                'data-theme',
                this.getAttribute('data-theme') === 'dark' ? 'light' : 'dark',
              );
              this.requestUpdate();
            }}
          >
            切换明暗</button
          ><button id="open-editor" ?disabled=${this.opened} @click=${() => this.reopen()}>
            ${this.saved ? '编辑已保存建议' : '新建反馈'}
          </button>
        </div>
      </header>
      <div class="intro">
        <h1>调到你想要的样子。</h1>
        <p>
          点击卡片、标题或按钮，试着调整样式，再把具体修改和反馈一起保存。拖动面板顶部可挪开遮挡。
        </p>
      </div>
      <p class="notice" role="status">
        ${this.notice || 'Storybook 交互原型 · 建议只保存在本次示例中'}
      </p>
      <div class="workspace">
        <div class="sample-area">
          <div class="eyebrow">LIVE PAGE / 团队工作空间</div>
          <article
            id="prototype-card"
            class="sample"
            data-selected=${String(this.opened && this.active === 'prototype-card')}
            @click=${(event: Event) => {
              event.stopPropagation();
              this.select('prototype-card');
            }}
          >
            <span class="sample-label">LUMEN / TEAM PLAN</span>
            <h2
              id="prototype-title"
              data-selected=${String(this.opened && this.active === 'prototype-title')}
              @click=${(event: Event) => {
                event.stopPropagation();
                this.select('prototype-title');
              }}
            >
              给下一个想法，<br />留点空间。
            </h2>
            <p>把草稿、讨论和下一步，<br />放进同一个工作空间。</p>
            <div class="price">¥ 49 <small>/ 人 / 月</small></div>
            <ul>
              <li>不限数量的想法与草稿</li>
              <li>与团队共享上下文</li>
              <li>把讨论变成下一步行动</li>
            </ul>
            <button
              id="prototype-cta"
              data-selected=${String(this.opened && this.active === 'prototype-cta')}
              @click=${(event: Event) => {
                event.stopPropagation();
                this.select('prototype-cta');
              }}
            >
              开始免费试用 <span>↗</span>
            </button>
            ${this.opened ? html`<span class="target-marker" aria-hidden="true">1</span>` : nothing}
          </article>
          <p class="sample-hint">
            试试把按钮的内边距改为 16px，或者让卡片更圆润。<br />保存建议后，这里会恢复原样。
          </p>
        </div>
        ${
          this.opened
            ? html`<section
                class="panel ${this.draggingFile ? 'file-over' : ''}"
                aria-label="标注与样式编辑器"
                ?hidden=${this.attachments.busy}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.isComposing) return;
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && this.canSave()) {
                    event.preventDefault();
                    this.close(true);
                  } else if (event.key === 'Escape') {
                    event.preventDefault();
                    this.close(false);
                  }
                }}
                @paste=${(event: ClipboardEvent) => {
                  const image = [...(event.clipboardData?.files ?? [])].find((file) =>
                    file.type.startsWith('image/'),
                  );
                  if (image) {
                    event.preventDefault();
                    this.importImage(image);
                  }
                }}
                @dragover=${(event: DragEvent) => {
                  if (!event.dataTransfer?.types.includes('Files')) return;
                  event.preventDefault();
                  this.draggingFile = true;
                  this.requestUpdate();
                }}
                @dragleave=${(event: DragEvent) => {
                  if (
                    event.relatedTarget instanceof Node &&
                    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
                  )
                    return;
                  this.draggingFile = false;
                  this.requestUpdate();
                }}
                @drop=${(event: DragEvent) => {
                  event.preventDefault();
                  this.draggingFile = false;
                  this.importImage(event.dataTransfer?.files[0]);
                  this.requestUpdate();
                }}
              >
                <div class="target-header">
                  <div class="target-line">
                    <strong title=${target.label}
                      >${target.parent ? 'article › ' : ''}${target.tag} "${target.label}"</strong
                    >
                    <button
                      class="drag-handle"
                      aria-label="移动面板"
                      title="拖动，或使用方向键移动"
                      @pointerdown=${(event: PointerEvent) => this.startDrag(event)}
                      @pointermove=${(event: PointerEvent) => {
                        if (this.drag?.id === event.pointerId)
                          this.movePanel(
                            this.drag.left + event.clientX - this.drag.x,
                            this.drag.top + event.clientY - this.drag.y,
                          );
                      }}
                      @pointerup=${() => {
                        this.drag = null;
                      }}
                      @pointercancel=${() => {
                        this.drag = null;
                      }}
                      @lostpointercapture=${() => {
                        this.drag = null;
                      }}
                      @keydown=${(event: KeyboardEvent) => {
                        if (!event.key.startsWith('Arrow')) return;
                        event.preventDefault();
                        const panel = this.renderRoot.querySelector<HTMLElement>('.panel')!;
                        this.movePanel(
                          panel.offsetLeft +
                            (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0),
                          panel.offsetTop +
                            (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0),
                        );
                      }}
                    >
                      ${icon(GripVertical)}
                    </button>
                    ${
                      target.parent
                        ? html`<button
                            class="icon"
                            aria-label="选择父元素"
                            title="选择父元素"
                            ?disabled=${!target.parent}
                            @click=${() => {
                              this.previous = this.active;
                              this.active = target.parent!;
                              this.requestUpdate();
                            }}
                          >
                            ${icon(ArrowUp)}
                          </button>`
                        : nothing
                    }
                    ${
                      this.previous
                        ? html`<button
                            class="icon"
                            aria-label="返回原目标"
                            title="返回原目标"
                            ?disabled=${!this.previous}
                            @click=${() => {
                              this.active = this.previous!;
                              this.previous = null;
                              this.requestUpdate();
                            }}
                          >
                            ${icon(ArrowDown)}
                          </button>`
                        : nothing
                    }
                  </div>
                  <div class="target-locator">
                    <code title=${`#${target.id}`}>#${target.id}</code
                    ><button
                      class="copy-selector"
                      aria-label="复制选择符"
                      title="复制选择符"
                      @click=${() => this.copySelector()}
                    >
                      ${icon(Copy)}
                    </button>
                  </div>
                  <details class="target-details">
                    <summary>定位详情</summary>
                    <pre>
Shadow hosts:
ainotation-style-editor-prototype
Selector:
#${target.id}</pre>
                    <pre>
${target.parent ? `article#${target.parent} > ` : ''}${target.tag}#${target.id}</pre>
                  </details>
                  ${
                    this.multiple ||
                    Object.values(this.changes).filter((values) => Object.keys(values).length)
                      .length > 1
                      ? html`<select
                          class="target-picker"
                          aria-label="当前编辑目标"
                          .value=${live(this.active)}
                          @change=${(event: Event) => this.select((event.target as HTMLSelectElement).value)}
                        >
                          ${targets.map((item) => html`<option value=${item.id}>${item.tag} · ${item.label} (${Object.keys(this.changes[item.id] ?? {}).length} 项修改)</option>`)}
                        </select>`
                      : nothing
                  }
                </div>
                <div
                  class="tabs"
                  role="tablist"
                  aria-label="标注内容"
                  @keydown=${(event: KeyboardEvent) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const tab =
                      event.key === 'Home'
                        ? 'feedback'
                        : event.key === 'End'
                          ? 'styles'
                          : this.tab === 'feedback'
                            ? 'styles'
                            : 'feedback';
                    this.setTab(tab);
                    void this.updateComplete.then(() =>
                      this.renderRoot.querySelector<HTMLButtonElement>(`#${tab}-tab`)?.focus(),
                    );
                  }}
                >
                  <button
                    role="tab"
                    id="feedback-tab"
                    aria-controls="feedback-panel"
                    aria-selected=${String(this.tab === 'feedback')}
                    tabindex=${this.tab === 'feedback' ? 0 : -1}
                    @click=${() => this.setTab('feedback')}
                  >
                    反馈
                  </button>
                  <button
                    role="tab"
                    id="styles-tab"
                    aria-controls="styles-panel"
                    aria-selected=${String(this.tab === 'styles')}
                    tabindex=${this.tab === 'styles' ? 0 : -1}
                    @click=${() => this.setTab('styles')}
                  >
                    样式${count ? html`<span class="pill">${count}</span>` : nothing}
                  </button>
                </div>
                ${
                  this.tab === 'styles'
                    ? this.stylePanel()
                    : html`<div
                        class="panel-body feedback-body"
                        id="feedback-panel"
                        role="tabpanel"
                        aria-labelledby="feedback-tab"
                      >
                        <textarea
                          id="feedback-comment"
                          aria-label="反馈内容"
                          aria-keyshortcuts="Meta+Enter Control+Enter"
                          rows="3"
                          maxlength="10000"
                          .value=${live(this.comment)}
                          @input=${(event: Event) => {
                            this.comment = (event.target as HTMLTextAreaElement).value;
                            this.requestUpdate();
                          }}
                        ></textarea>
                        ${this.imageList()}
                      </div>`
                }
                <footer class="panel-footer">
                  ${
                    this.tab === 'styles'
                      ? html`<div class="style-restore">
                          <button
                            class="quiet"
                            ?disabled=${!count && !Object.keys(this.errors).length}
                            @click=${() => {
                              this.remember();
                              this.changes = {};
                              this.raw = {};
                              this.errors = {};
                              this.requestUpdate();
                            }}
                          >
                            全部恢复</button
                          ><span>${count ? `${count} 项样式建议` : '尚未修改样式'}</span>
                        </div>`
                      : nothing
                  }
                  <div class="actions">
                    ${
                      this.tab === 'feedback'
                        ? html`<button
                              aria-label="截图"
                              title="截图并绘制（需要屏幕共享授权）"
                              ?disabled=${this.images.length >= 8}
                              @click=${() => {
                                this.panelMessage = '';
                                this.attachments.screenshot();
                              }}
                            >
                              ${icon(Camera)}
                            </button>
                            <button
                              aria-label="选择图片"
                              title="选择图片"
                              ?disabled=${this.images.length >= 8}
                              @click=${() => this.renderRoot.querySelector<HTMLInputElement>('input[type="file"]')?.click()}
                            >
                              ${icon(ImagePlus)}
                            </button>`
                        : nothing
                    }
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      hidden
                      @change=${(event: Event) => {
                        const input = event.target as HTMLInputElement;
                        this.importImage(input.files?.[0]);
                        input.value = '';
                      }}
                    />
                    <div class="actions-end">
                      <button
                        aria-label="取消"
                        title="取消（Esc）"
                        @click=${() => this.close(false)}
                      >
                        ${icon(X)}
                      </button>
                      <button
                        class="primary"
                        aria-label=${this.saved ? '保存' : '添加标注'}
                        title=${`${this.saved ? '保存' : '添加标注'}（Command / Ctrl + Enter）`}
                        aria-keyshortcuts="Meta+Enter Control+Enter"
                        ?disabled=${!this.canSave()}
                        @click=${() => this.close(true)}
                      >
                        ${icon(Check)}
                      </button>
                      ${this.saved ? html`<button class="danger" aria-label="删除标注" title="删除标注" @click=${() => this.deleteSaved()}>${icon(Trash2)}</button>` : nothing}
                    </div>
                  </div>
                  ${this.tab === 'feedback' ? html`<p class="import-hint">在此粘贴或拖入图片${this.images.length ? ` · ${this.images.length}/8` : ''}</p>` : nothing}
                  ${count ? html`<p class="footer-note">已附 ${count} 项样式建议，保存后还原页面预览。</p>` : nothing}
                  ${Object.keys(this.errors).length ? html`<p class="field-error" role="alert">样式页有属性值需要修正。</p>` : nothing}
                  ${this.panelMessage ? html`<p class="message" role="status">${this.panelMessage}</p>` : nothing}
                </footer>
              </section>`
            : nothing
        }
        ${
          this.saved && output
            ? html`<section class="saved" aria-label="已保存建议">
                <div class="saved-card">
                  <div class="row">
                    <h3>✓ 已保存的反馈</h3>
                    <span class="badge">${this.count(this.saved.changes)} 项样式</span>
                  </div>
                  ${this.saved.comment ? html`<p>${this.saved.comment}</p>` : nothing}
                  ${this.imageList(this.saved.images, false)}
                  ${output.targets.map(
                    (item) =>
                      html`<p><code>${item.selector}</code></p>
                        <table class="changes-table" aria-label=${`${item.selector} 样式建议`}>
                          <tbody>
                            ${item.styleChanges.map(
                              (change) =>
                                html`<tr>
                                  <td>${change.property}</td>
                                  <td>${change.before}</td>
                                  <td>→ ${change.value}</td>
                                </tr>`,
                            )}
                          </tbody>
                        </table>`,
                  )}
                  <button @click=${() => this.reopen()}>重新编辑 / 预览</button>
                  <details>
                    <summary>查看交接数据示意</summary>
                    <pre>${JSON.stringify(output, null, 2)}</pre>
                  </details>
                </div>
              </section>`
            : nothing
        }
      </div>
    </div>`;
  }
}

if (!customElements.get('ainotation-style-editor-prototype'))
  customElements.define('ainotation-style-editor-prototype', StyleEditorPrototype);
