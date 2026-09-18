import type { StorybookConfig } from '@storybook/web-components-vite';

const config: StorybookConfig = {
  framework: '@storybook/web-components-vite',
  stories: ['../src/*.stories.ts'],
  core: { disableTelemetry: true },
  viteFinal(config) {
    // Live SDK stories lazy-load IndexedDB; prebundle it before the first mount.
    config.optimizeDeps ??= {};
    // pnpm can replace peer-resolution paths while this workspace is installed.
    config.optimizeDeps.force = true;
    config.optimizeDeps.include = [...(config.optimizeDeps.include ?? []), '@ainotation/sdk > idb'];
    return config;
  },
};

export default config;
