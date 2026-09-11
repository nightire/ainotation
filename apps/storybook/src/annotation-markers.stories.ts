import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, render } from 'lit';
import { createMarkerLayer } from '../../../packages/sdk/src/ui/markers';
import {
  emptyViewState,
  type InspectorAction,
  type InspectorViewState,
} from '../../../packages/sdk/src/core/types';

class MarkerPreview extends HTMLElement {
  theme: InspectorViewState['theme'] = 'light';
  mode: 'new' | 'saved' | 'edit' | 'text' = 'new';
  private layer: ReturnType<typeof createMarkerLayer> | undefined;

  connectedCallback() {
    this.style.cssText = 'display:block;padding:64px 48px;color:#263330;font:14px system-ui;';
    render(
      html`<section aria-label="Example page">
        <h2>Checkout</h2>
        ${
          this.mode === 'text'
            ? html`<p id="marker-preview-target" style="display:inline-block;margin-top:32px">
                Continue to paymnt
              </p>`
            : html`<button
                id="marker-preview-target"
                style="margin-top:32px;padding:12px 24px;border:0;border-radius:4px;background:#087f75;color:white"
              >
                Continue to payment
              </button>`
        }
      </section>`,
      this,
    );
    const now = new Date().toISOString();
    const target = {
      id: crypto.randomUUID(),
      selector: '#marker-preview-target',
      shadowHosts: [],
      tagName: this.mode === 'text' ? 'p' : 'button',
      text: this.mode === 'text' ? 'Continue to paymnt' : 'Continue to payment',
      attributes: {},
      rect: { x: 48, y: 160, width: 190, height: 40 },
      styles: {},
      ...(this.mode === 'text'
        ? {
            textSelection: {
              exact: 'paymnt',
              prefix: 'Continue to ',
              suffix: '',
              truncated: false,
              rects: [],
            },
          }
        : {}),
    };
    const marker = {
      x: 238,
      y: 200,
      space: 'document' as const,
      targetId: target.id,
      ratioX: 1,
      ratioY: 1,
    };
    const annotation = {
      id: crypto.randomUUID(),
      comment: 'Align this button with the order summary.',
      createdAt: now,
      updatedAt: now,
      targets: [target],
      marker,
      status: 'pending' as const,
      replies: [],
      page: {
        url: 'http://localhost/checkout',
        title: 'Checkout',
        viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      },
    };
    let state: InspectorViewState = {
      ...emptyViewState(),
      theme: this.theme,
      storage: 'ready',
      picking: true,
      document: {
        schemaVersion: 1,
        id: crypto.randomUUID(),
        url: annotation.page.url,
        createdAt: now,
        annotations: this.mode === 'new' || this.mode === 'text' ? [] : [annotation],
      },
      selected: this.mode === 'saved' ? [] : [target],
      marker,
      editorOpen: this.mode !== 'saved',
      editingId: this.mode === 'edit' ? annotation.id : null,
      draft: this.mode === 'edit' ? annotation.comment : '',
    };
    const closeEditor = () => {
      state = {
        ...state,
        editorOpen: false,
        editingId: null,
        selected: [],
        marker: null,
        draft: '',
      };
    };
    this.layer = createMarkerLayer({
      getRect: () => {
        const rect = this.querySelector('#marker-preview-target')?.getBoundingClientRect();
        return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null;
      },
      onAction: (action: InspectorAction) => {
        if (action.type === 'draft') state = { ...state, draft: action.value };
        else if (action.type === 'cancel-edit') closeEditor();
        else if (action.type === 'edit') {
          const current = state.document?.annotations.find((item) => item.id === action.id);
          if (current)
            state = {
              ...state,
              editingId: current.id,
              editorOpen: true,
              selected: current.targets,
              marker: current.marker ?? marker,
              draft: current.comment,
            };
        } else if (action.type === 'save' && state.draft.trim() && state.document) {
          const saved = {
            ...annotation,
            id: state.editingId ?? annotation.id,
            comment: state.draft.trim(),
          };
          state = { ...state, document: { ...state.document, annotations: [saved] } };
          closeEditor();
        } else if (action.type === 'delete' && state.document) {
          state = { ...state, document: { ...state.document, annotations: [] } };
          closeEditor();
        }
        this.layer?.update(state, true);
      },
    });
    this.layer.update(state, true);
  }

  disconnectedCallback() {
    this.layer?.destroy();
    this.layer = undefined;
  }
}

if (!customElements.get('ainotation-marker-preview'))
  customElements.define('ainotation-marker-preview', MarkerPreview);

const meta = {
  title: 'Annotations/Markers',
  render: (args: { mode: MarkerPreview['mode']; theme?: InspectorViewState['theme'] }) => {
    const preview = document.createElement('ainotation-marker-preview') as MarkerPreview;
    preview.mode = args.mode;
    preview.theme = args.theme ?? 'light';
    return preview;
  },
} satisfies Meta<{ mode: MarkerPreview['mode']; theme?: InspectorViewState['theme'] }>;
export default meta;
type Story = StoryObj<{ mode: MarkerPreview['mode']; theme?: InspectorViewState['theme'] }>;

export const NewFeedback: Story = { args: { mode: 'new' } };
export const SavedFeedback: Story = { args: { mode: 'saved' } };
export const EditFeedback: Story = { args: { mode: 'edit' } };
export const TextSelection: Story = { args: { mode: 'text' } };
export const DarkTextSelection: Story = { args: { mode: 'text', theme: 'dark' } };
