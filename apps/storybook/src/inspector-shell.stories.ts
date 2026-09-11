import type { InspectorShell } from '@ainotation/sdk/ui';
import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, render } from 'lit';
import { expect, within } from 'storybook/test';

import {
  emptyViewState,
  type InspectorAction,
  type InspectorViewState,
} from '../../../packages/sdk/src/core/types';

interface Args {
  view: InspectorViewState;
  expanded: boolean;
}

const target: InspectorViewState['selected'][number] = {
  id: '11111111-1111-4111-8111-111111111111',
  selector: '#checkout .primary-button',
  shadowHosts: [],
  tagName: 'button',
  text: 'Continue to payment',
  attributes: { type: 'button', class: 'primary-button' },
  rect: { x: 40, y: 180, width: 180, height: 40 },
  styles: { color: 'rgb(255, 255, 255)', backgroundColor: 'rgb(8, 127, 117)' },
};

const secondTarget: typeof target = {
  ...target,
  id: '22222222-2222-4222-8222-222222222222',
  selector: '#checkout .order-summary',
  tagName: 'aside',
  text: 'Order summary',
};

const feedback: NonNullable<InspectorViewState['document']> = {
  schemaVersion: 1,
  id: '33333333-3333-4333-8333-333333333333',
  url: 'http://localhost:5173/checkout',
  createdAt: '2026-09-09T10:00:00.000Z',
  annotations: [
    {
      id: '44444444-4444-4444-8444-444444444444',
      comment: 'Align the payment button with the order summary and increase the space above it.',
      createdAt: '2026-09-09T10:00:00.000Z',
      updatedAt: '2026-09-09T10:00:00.000Z',
      page: {
        url: 'http://localhost:5173/checkout',
        title: 'Checkout',
        viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      },
      targets: [target, secondTarget],
      status: 'pending',
      replies: [],
    },
  ],
};

const empty: InspectorViewState = {
  ...emptyViewState(),
  storage: 'ready',
  document: { ...feedback, annotations: [] },
};

const multipleFeedback: typeof feedback = {
  ...feedback,
  annotations: [
    { ...feedback.annotations[0]!, targets: [target] },
    {
      ...feedback.annotations[0]!,
      id: '55555555-5555-4555-8555-555555555555',
      comment: 'Make the order total more prominent in the summary.',
      targets: [secondTarget],
    },
  ],
};

const meta = {
  title: 'Inspector/Shell',
  component: 'ainotation-inspector-shell',
  args: { view: empty, expanded: false },
  argTypes: { view: { control: 'object' }, expanded: { control: 'boolean' } },
  render: ({ view, expanded }) => {
    const preview = document.createElement('div');
    let state = { ...structuredClone(view), picking: expanded && view.storage !== 'loading' };
    const draw = () =>
      render(
        html`
          <ainotation-inspector-shell
            .view=${state}
            .expanded=${expanded}
            @ainotation-action=${(event: CustomEvent<InspectorAction>) => {
              const action = event.detail;
              switch (action.type) {
                case 'set-picking':
                  expanded = action.value;
                  state = { ...state, picking: action.value };
                  break;
                case 'set-output-detail':
                  state = { ...state, outputDetail: action.value };
                  break;
                case 'set-theme':
                  state = { ...state, theme: action.value };
                  break;
                case 'connect':
                case 'disconnect':
                case 'copy':
                case 'export':
                  // Report only the action name; connection tokens must never enter the fixture state.
                  state = { ...state, message: `Preview action: ${action.type}` };
                  break;
                case 'clear-all':
                  state = {
                    ...state,
                    selected: [],
                    draft: '',
                    editingId: null,
                    editorOpen: false,
                    marker: null,
                    document: state.document ? { ...state.document, annotations: [] } : null,
                    message: 'All annotations on this page cleared',
                  };
                  break;
                default:
                  return;
              }
              draw();
            }}
          ></ainotation-inspector-shell>
        `,
        preview,
      );
    draw();
    return preview;
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Minimized: Story = {
  args: { expanded: false },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector<InspectorShell>('ainotation-inspector-shell');
    if (!shell) throw new Error('Inspector is missing');
    await shell.updateComplete;
    const launcher = shell.shadowRoot?.querySelector<HTMLButtonElement>('.launcher');
    if (!launcher) throw new Error('Launcher is missing');
    await expect(launcher).toBeVisible();
    await expect(launcher).toHaveTextContent('A');
    await expect(shell.expanded).toBe(false);
  },
};

export const Empty: Story = {
  args: { expanded: true },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector<InspectorShell>('ainotation-inspector-shell');
    if (!shell) throw new Error('Inspector is missing');
    await shell.updateComplete;
    const panel = shell.shadowRoot?.querySelector<HTMLElement>(
      '[aria-label="Ainotation inspector"]',
    );
    if (!panel) throw new Error('Inspector content is missing');
    await expect(panel).toBeVisible();
    await expect(panel.querySelector('[aria-label^="Annotations ("]')).toBeNull();
    await expect(within(panel).getByRole('button', { name: 'Copy feedback' })).toBeEnabled();
    await expect(within(panel).getByRole('button', { name: 'Export JSON' })).toBeEnabled();
    await expect(panel.querySelector('textarea, article, ol, ul')).toBeNull();
  },
};

export const WithFeedback: Story = {
  args: { expanded: true, view: { ...empty, document: feedback } },
};

export const Dark: Story = {
  args: { expanded: true, view: { ...empty, theme: 'dark', document: feedback } },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector<InspectorShell>('ainotation-inspector-shell');
    if (!shell) throw new Error('Inspector is missing');
    shell.settingsOpen = true;
    await shell.updateComplete;
  },
};

export const SettingsOpen: Story = {
  args: { expanded: true, view: empty },
  play: async ({ canvasElement }) => {
    const shell = canvasElement.querySelector<InspectorShell>('ainotation-inspector-shell');
    if (!shell) throw new Error('Inspector is missing');
    shell.settingsOpen = true;
    await shell.updateComplete;
    await expect(shell.shadowRoot!.querySelector('[role="dialog"]')).toBeVisible();
  },
};

export const MultipleAnnotations: Story = {
  args: { expanded: true, view: { ...empty, document: multipleFeedback } },
};

export const Connected: Story = {
  args: {
    expanded: true,
    view: {
      ...empty,
      connection: 'connected',
      document: multipleFeedback,
    },
  },
};

export const ConnectionError: Story = {
  args: {
    expanded: true,
    view: {
      ...empty,
      document: feedback,
      connection: 'error',
      storage: 'unavailable',
      message: 'Cannot reach the MCP server. Check the endpoint and token.',
    },
  },
};
