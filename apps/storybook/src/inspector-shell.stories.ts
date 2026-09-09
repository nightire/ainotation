import type { Meta, StoryObj } from '@storybook/web-components-vite';
import { html, render } from 'lit';

interface Args {
  statusLabel: string;
}

const meta = {
  title: 'Inspector/Shell',
  component: 'ainotation-inspector-shell',
  args: { statusLabel: 'Ready' },
  argTypes: { statusLabel: { control: 'text' } },
  render: ({ statusLabel }) => {
    const preview = document.createElement('div');
    render(
      html`
        <ainotation-inspector-shell
          .statusLabel=${statusLabel}
          @ainotation-close=${() => render(html`<p role="status">Inspector closed</p>`, preview)}
        ></ainotation-inspector-shell>
      `,
      preview,
    );
    return preview;
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Ready: Story = {};
export const NotConnected: Story = { args: { statusLabel: 'Not connected' } };
