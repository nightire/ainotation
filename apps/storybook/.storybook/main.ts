import type { StorybookConfig } from '@storybook/web-components-vite';

const config: StorybookConfig = {
  framework: '@storybook/web-components-vite',
  stories: ['../src/*.stories.ts'],
  core: { disableTelemetry: true },
};

export default config;
