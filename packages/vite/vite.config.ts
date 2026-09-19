import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/client.ts', 'src/variants.ts'],
    platform: 'node',
    target: 'node24',
    format: ['esm'],
    dts: true,
    sourcemap: true,
  },
  resolve: { conditions: ['development'] },
  test: {
    name: 'vite-plugin',
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
});
