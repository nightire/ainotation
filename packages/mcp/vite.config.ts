import { defineConfig } from 'vite-plus';

export default defineConfig({
  pack: {
    entry: [
      'src/index.ts',
      'src/cli.ts',
      'src/project.ts',
      'src/shared-service.ts',
      'src/project-mcp.ts',
      'src/service-discovery.ts',
      'src/browser-connection.ts',
      'src/project-registration.ts',
    ],
    platform: 'node',
    target: 'node24',
    format: ['esm'],
    dts: true,
    sourcemap: true,
  },
  resolve: { conditions: ['development'] },
  test: { name: 'mcp', environment: 'node' },
});
