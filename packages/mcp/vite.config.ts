import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: ['src/index.ts', 'src/cli.ts'],
    platform: 'node',
    target: 'node24',
    format: ['esm'],
    dts: true,
    sourcemap: true,
  },
  resolve: { conditions: ['development'] },
  test: { name: 'mcp', environment: 'node' },
});
