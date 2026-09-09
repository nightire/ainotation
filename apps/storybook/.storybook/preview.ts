import { registerInspectorShell } from '@ainotation/sdk/ui';
import type { Preview } from '@storybook/web-components-vite';

registerInspectorShell();

const preview: Preview = {
  parameters: { layout: 'padded' },
};

export default preview;
