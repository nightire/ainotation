import { defineConfig } from 'vite-plus';

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ainotation/' : '/',
  test: {
    name: 'website',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 30000,
    maxWorkers: 1,
  },
}));
