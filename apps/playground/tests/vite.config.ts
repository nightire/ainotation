import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    name: 'feedback-integration',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    // Each worker starts Vite and Chrome; avoid competing browser startups.
    maxWorkers: 2,
    hookTimeout: 30000,
    server: { deps: { inline: [/^@ainotation\//] } },
  },
});
