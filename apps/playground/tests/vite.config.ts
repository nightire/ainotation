import { defineConfig } from 'vite-plus';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: {
    name: 'feedback-integration',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
    // Browser startup and IndexedDB commits on hosted runners can exceed the
    // default one-second poll; match the Playwright interaction timeout.
    expect: { poll: { timeout: 5000 } },
    // Each worker starts Vite and Chrome; avoid competing browser startups.
    maxWorkers: 2,
    hookTimeout: 30000,
    server: { deps: { inline: [/^@ainotation\//] } },
  },
});
