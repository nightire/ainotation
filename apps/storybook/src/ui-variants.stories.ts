import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html } from 'lit';
import {
  applyFeedbackOperation,
  createFeedbackDocument,
  createVariantExploration,
} from '../../../packages/schema/src';
import { defineVariants } from '../../../packages/sdk/src/variants';
import { createVariantsController } from '../../../packages/sdk/src/core/variants-controller';
import { emptyViewState, type InspectorViewState } from '../../../packages/sdk/src/core/types';
import { createMarkerLayer } from '../../../packages/sdk/src/ui/markers';

class VariantsPreview extends HTMLElement {
  theme: InspectorViewState['theme'] = 'light';
  locale: InspectorViewState['locale'] = 'en';
  private dispose: (() => void) | undefined;
  connectedCallback() {
    this.style.cssText = 'display:block;padding:48px;font:15px system-ui;min-height:520px';
    this.innerHTML =
      '<h2>UI Variants</h2><p>Component demo: the MCP agent is simulated. Candidate rendering uses the public host protocol.</p><div data-example-host style="display:flex;gap:24px;align-items:center;margin-top:48px"></div>';
    const host = this.querySelector<HTMLElement>('[data-example-host]')!;
    const document = createFeedbackDocument(location.href);
    const targets = [0, 1].map((index) => ({
      id: crypto.randomUUID(),
      selector: `[data-example-slot="${index}"]`,
      shadowHosts: [],
      tagName: index ? 'p' : 'button',
      text: index ? 'Supporting text' : 'Continue',
      attributes: {},
      styles: {},
      rect: { x: 48, y: 160, width: 180, height: 48 },
    }));
    const exploration = createVariantExploration(
      crypto.randomUUID(),
      targets.map((target) => target.id),
    );
    exploration.status = 'published';
    exploration.revision = 2;
    exploration.manifest = {
      generation: 1,
      choices: [
        { id: 'compact', label: 'Compact' },
        { id: 'expressive', label: 'Expressive' },
        { id: 'soft', label: 'Soft' },
      ],
    };
    const annotation = {
      id: crypto.randomUUID(),
      comment: 'Explore a coordinated action and supporting message.',
      createdAt: document.createdAt,
      updatedAt: document.createdAt,
      targets,
      status: 'pending' as const,
      replies: [],
      variants: exploration,
      page: {
        url: location.href,
        title: 'UI Variants demo',
        viewport: { width: innerWidth, height: innerHeight, devicePixelRatio, scrollX, scrollY },
      },
    };
    document.annotations.push(annotation);
    let state: InspectorViewState = {
      ...emptyViewState(),
      document,
      storage: 'ready',
      connection: 'connected',
      variantsSupported: true,
      variantAnnotationId: annotation.id,
      theme: this.theme,
      locale: this.locale,
    };
    const group = defineVariants({
      explorationId: exploration.id,
      targetIds: exploration.targetIds,
      generations: [
        { generation: 1, variants: exploration.manifest.choices.map((choice) => choice.id) },
      ],
    });
    let bindings: (() => void)[] = [];
    const paintHost = () => {
      for (const release of bindings) release();
      bindings = [];
      host.replaceChildren();
      const snapshot = group.getSnapshot();
      targets.forEach((target, index) => {
        const element = window.document.createElement(
          index ? (snapshot.variantId === 'expressive' ? 'aside' : 'p') : 'button',
        );
        element.dataset.exampleSlot = String(index);
        element.textContent = index
          ? `${snapshot.variantId}: supporting message`
          : snapshot.variantId === 'expressive'
            ? 'Continue →'
            : 'Continue';
        element.style.cssText = `padding:${snapshot.variantId === 'compact' ? '8px 12px' : '16px 24px'};border:1px solid #087268;border-radius:${snapshot.variantId === 'soft' ? '24px' : '4px'};background:${snapshot.variantId === 'expressive' ? '#004643' : '#e8f1ed'};color:${snapshot.variantId === 'expressive' ? '#fffffe' : '#17483d'}`;
        host.append(element);
        bindings.push(group.bind(target.id, element, snapshot));
      });
    };
    const unsubscribe = group.subscribe(paintHost);
    paintHost();
    let layer: ReturnType<typeof createMarkerLayer> | undefined;
    const update = () => {
      state.variantPreview = controller.state();
      state.variantsComparing = state.document?.annotations[0]?.variants?.status === 'published';
      layer?.update(state, true);
    };
    const controller = createVariantsController({ onChange: update, onReport() {} });
    layer = createMarkerLayer({
      getRect: (target) => controller.rect(target.id),
      onAction(action) {
        if (action.type === 'variant-preview') controller.select(action.value);
        else if (action.type === 'variant-position') state.variantPosition = action.position;
        else if (action.type === 'variant-minimized') state.variantMinimized = action.value;
        else if (action.type === 'variant-feedback') state.variantFeedback = action.value;
        else if (action.type === 'variant-decision') {
          const current = state.document!.annotations[0]!.variants!;
          state.document = applyFeedbackOperation(state.document!, {
            id: crypto.randomUUID(),
            kind: 'variants',
            annotationId: annotation.id,
            explorationId: current.id,
            generation: current.generation,
            revision: current.revision,
            action:
              action.decision === 'accept'
                ? {
                    type: 'accept',
                    variantId: controller.state().variantId,
                    feedback: state.variantFeedback,
                  }
                : { type: action.decision, feedback: state.variantFeedback },
          });
          state.variantFeedback = '';
          controller.sync(state.document.annotations[0]!.variants);
        } else if (action.type === 'edit') {
          state = {
            ...state,
            editingId: annotation.id,
            editorOpen: true,
            selected: targets,
            draft: annotation.comment,
            variantsRequested: true,
            variantStyleBlocked: true,
          };
        } else if (action.type === 'cancel-edit') state.editorOpen = false;
        update();
      },
    });
    controller.sync(exploration);
    update();
    this.dispose = () => {
      controller.destroy();
      unsubscribe();
      for (const release of bindings) release();
      group.dispose();
      layer?.destroy();
    };
  }
  disconnectedCallback() {
    this.dispose?.();
    this.dispose = undefined;
  }
}
if (!customElements.get('ainotation-variants-preview'))
  customElements.define('ainotation-variants-preview', VariantsPreview);
const meta = {
  title: 'Annotations/UI Variants',
  parameters: { layout: 'fullscreen' },
  render: () => html`<ainotation-variants-preview></ainotation-variants-preview>`,
} satisfies Meta;
export default meta;
type Story = StoryObj;
export const Light: Story = {};
export const Dark: Story = {
  render: () => html`<ainotation-variants-preview .theme=${'dark'}></ainotation-variants-preview>`,
};
export const Chinese: Story = {
  render: () =>
    html`<ainotation-variants-preview .locale=${'zh-Hans'}></ainotation-variants-preview>`,
};
