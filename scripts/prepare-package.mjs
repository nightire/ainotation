import { copyFile, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = process.cwd();
const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
if (
  !['@ainotation/schema', '@ainotation/sdk', '@ainotation/mcp', '@ainotation/vite'].includes(
    manifest.name,
  )
)
  throw new Error('Only public Ainotation packages may run this prepack hook.');
for (const entry of Object.values(manifest.publishConfig.exports)) {
  await access(resolve(directory, entry.import));
  await access(resolve(directory, entry.types));
}
await copyFile(join(root, 'LICENSE'), join(directory, 'LICENSE'));

if (manifest.name === '@ainotation/sdk') {
  const require = createRequire(join(directory, 'package.json'));
  // These dependencies are bundled by the SDK. Their licenses remain separate
  // from Ainotation's license, including Lucide's Feather-derived icon notices.
  const licenses = [];
  const maps = (await readdir(join(directory, 'dist'))).filter((file) => file.endsWith('.map'));
  const bundledSources = (
    await Promise.all(
      maps.map(
        async (file) =>
          JSON.parse(await readFile(join(directory, 'dist', file), 'utf8')).sources ?? [],
      ),
    )
  ).flat();
  const seen = new Set();
  const queue = ['lit', 'lucide'].map((name) => ({ name, resolver: require }));
  while (queue.length) {
    const { name, resolver } = queue.shift();
    let current = dirname(resolver.resolve(name));
    while (true) {
      try {
        const pkg = JSON.parse(await readFile(join(current, 'package.json'), 'utf8'));
        if (pkg.name === name) {
          if (seen.has(`${name}@${pkg.version}`)) break;
          seen.add(`${name}@${pkg.version}`);
          licenses.push(
            `${name} ${pkg.version}\n\n${await readFile(join(current, 'LICENSE'), 'utf8')}`,
          );
          const nextResolver = createRequire(join(current, 'package.json'));
          for (const dependency of Object.keys(pkg.dependencies ?? {})) {
            if (
              /^(lit|@lit\/|@lit-labs\/)/.test(dependency) &&
              bundledSources.some((source) => source.includes(`/node_modules/${dependency}/`))
            )
              queue.push({ name: dependency, resolver: nextResolver });
          }
          break;
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      const parent = dirname(current);
      if (parent === current) throw new Error(`Cannot locate ${name}'s license`);
      current = parent;
    }
  }
  await writeFile(
    join(directory, 'THIRD_PARTY_NOTICES'),
    `Third-party components bundled with @ainotation/sdk\n\n${licenses.join('\n---\n\n')}`,
  );
}
