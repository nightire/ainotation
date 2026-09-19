import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite-plus';
import type { Locator, Page } from 'playwright';
import { expect } from 'vite-plus/test';

export function createPlaygroundServer(specifier: string) {
  const name = basename(fileURLToPath(specifier), '.test.ts');
  return createServer({
    root: resolve(import.meta.dirname, '..'),
    cacheDir: resolve(
      import.meta.dirname,
      '../../../node_modules/.cache/playground-tests/manual',
      name,
    ),
    optimizeDeps: { entries: ['tests/manual-entry.ts'] },
    configFile: false,
    plugins: [
      {
        name: 'playground-lifecycle-fixture',
        transformIndexHtml: {
          order: 'pre',
          handler: (html) => html.replace('src="/src/main.ts"', 'src="/tests/manual-entry.ts"'),
        },
      },
    ],
    server: { host: '127.0.0.1', port: 0 },
    logLevel: 'silent',
  });
}

export function configurePage(page: Page, errors: string[]) {
  page.setDefaultTimeout(5000);
  page.setDefaultNavigationTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
}

export async function previewVariant(controller: Locator, id: string) {
  const current = controller.locator('[data-current-variant]');
  for (let step = 0; step < 7; step++) {
    const previous = await current.getAttribute('data-current-variant');
    if (previous === id) return;
    await controller.getByRole('button', { name: 'Next design', exact: true }).click();
    await expect.poll(() => current.getAttribute('data-current-variant')).not.toBe(previous);
  }
  throw new Error(`Variant ${id} was not found in the navigation.`);
}
