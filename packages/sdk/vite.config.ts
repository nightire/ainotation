import { defineConfig } from 'vite-plus';
import { playwright } from 'vite-plus/test/browser-playwright';

export default defineConfig({
  pack: {
    entry: { index: 'src/index.ts', ui: 'src/ui/index.ts' },
    platform: 'browser',
    dts: true,
    format: ['esm'],
    sourcemap: true,
    outExtensions: () => ({ js: '.mjs', dts: '.d.mts' }),
    deps: {
      alwaysBundle: [/^lit/, /^@lit\//, /^@lit-labs\//, 'lucide'],
      onlyBundle: false,
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright({ launchOptions: { channel: 'chrome' } }),
      instances: [{ browser: 'chromium' }],
    },
  },
});
