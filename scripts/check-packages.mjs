import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(join(tmpdir(), 'ainotation-release-check-'));
const packages = ['schema', 'sdk', 'mcp', 'vite'];
const run = (command, args, cwd = root) =>
  exec(command, args, { cwd, maxBuffer: 10 * 1024 * 1024 });
try {
  const license = await readFile(join(root, 'LICENSE'), 'utf8');
  assert.match(license, /^MIT License\n/);
  const archives = [];
  let version;
  for (const name of packages) {
    const directory = join(root, 'packages', name);
    const source = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
    assert.equal(source.private, undefined);
    version ??= source.version;
    assert.equal(source.version, version, 'Public packages must share a release version');
    assert.match(version, /^\d+\.\d+\.\d+(?:-beta\.\d+)?$/);
    await run('pnpm', ['pack', '--pack-destination', temporary], directory);
    const archive = join(temporary, `ainotation-${name}-${version}.tgz`);
    archives.push(archive);
    const files = (await run('tar', ['-tf', archive])).stdout.trim().split('\n');
    const packed = JSON.parse((await run('tar', ['-xOf', archive, 'package/package.json'])).stdout);
    assert(files.includes('package/LICENSE'));
    assert(files.includes('package/README.md'));
    assert.equal(packed.license, 'MIT');
    assert.equal(
      (await run('tar', ['-xOf', archive, 'package/LICENSE'])).stdout,
      license,
      `${packed.name} must include the complete root MIT License`,
    );
    assert.equal(packed.publishConfig.access, 'public');
    assert.equal(packed.repository.url, 'git+https://github.com/nightire/ainotation.git');
    for (const file of files)
      assert(
        !/\/src\/|\.test\.|opencode|node_modules/.test(file),
        `Unexpected published file: ${file}`,
      );
    for (const entry of Object.values(packed.exports)) {
      assert.equal(
        entry.development,
        undefined,
        'Published development conditions must not point to unpacked source',
      );
      for (const path of [entry.import, entry.types])
        assert(files.includes(`package/${path.replace(/^\.\//, '')}`), `Missing export: ${path}`);
    }
    for (const [dependency, range] of Object.entries(packed.dependencies ?? {})) {
      assert(
        !/^(workspace|catalog|file|link):/.test(range),
        `Unresolved dependency ${dependency}: ${range}`,
      );
      if (dependency.startsWith('@ainotation/')) assert.equal(range, version);
    }
    for (const path of Object.values(packed.bin ?? {}))
      assert(files.includes(`package/${path.replace(/^\.\//, '')}`));
    if (name === 'sdk') assert(files.includes('package/THIRD_PARTY_NOTICES'));
    console.log(`Validated ${packed.name}@${packed.version}`);
  }
  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'ainotation-release-check', private: true, type: 'module' }),
  );
  // All packages are installed together from their actual tarballs. No workspace
  // symlinks or custom source conditions can hide a broken published export.
  await run(
    'npm',
    [
      '--userconfig',
      '/dev/null',
      'install',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...archives,
      '@types/node@24.13.3',
    ],
    consumer,
  );
  await writeFile(
    join(consumer, 'verify.mjs'),
    `
import assert from 'node:assert/strict';
import { createAinotation } from '@ainotation/sdk';
import { createFeedbackDocument } from '@ainotation/schema';
import { createMcpServer } from '@ainotation/mcp';
import { ainotation } from '@ainotation/vite';
import { defineVariants } from '@ainotation/sdk/variants';
assert.equal(createAinotation().mounted, false);
assert.deepEqual(defineVariants({ explorationId: 'ssr', targetIds: [], generations: [] }).getSnapshot(), { generation: 0, variantId: 'original' });
assert.equal(createFeedbackDocument('http://localhost/').annotations.length, 0);
assert.equal(ainotation({ name: 'package-check' }).name, 'ainotation');
const server = createMcpServer();
await server.close();
`,
  );
  await run(process.execPath, ['--conditions=development', 'verify.mjs'], consumer);
  await writeFile(
    join(consumer, 'verify.ts'),
    `
import { createAinotation, type AinotationOptions } from '@ainotation/sdk';
import { FeedbackExportSchema } from '@ainotation/schema';
import { createMcpServer } from '@ainotation/mcp';
import { ainotation } from '@ainotation/vite';
import '@ainotation/vite/variants';
import { defineVariants } from 'virtual:ainotation/variants';
import type { VariantGroupOptions } from '@ainotation/sdk/variants';
const options: AinotationOptions = { projectId: 'package-check' };
void [createAinotation(options), FeedbackExportSchema, createMcpServer, ainotation({ name: 'package-check' })];
const variants: VariantGroupOptions = { explorationId: 'type-check', targetIds: [], generations: [] };
void defineVariants(variants).getSnapshot().variantId;
`,
  );
  await writeFile(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2022',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        customConditions: ['development'],
      },
      include: ['verify.ts'],
    }),
  );
  await run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/lib/tsc.js'),
      '--project',
      join(consumer, 'tsconfig.json'),
    ],
    consumer,
  );
  console.log('Installed tarballs passed ESM and TypeScript consumer checks.');
} finally {
  await rm(temporary, { recursive: true, force: true });
}
