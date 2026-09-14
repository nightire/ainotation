import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// An npm package with only prereleases can have an unavoidable `latest` alias.
// Do not let Changesets' legacy tag inference leave the `beta` channel stale.
const temporary = await mkdtemp(join(tmpdir(), 'ainotation-publish-'));
const run = (...args) => execFileSync('vp', ['exec', 'changeset', ...args], { stdio: 'inherit' });
try {
  const planFile = join(temporary, 'publish-plan.json');
  const artifacts = join(temporary, 'packages');
  run('publish-plan', '--output', planFile);
  const plan = JSON.parse(await readFile(planFile, 'utf8'));
  for (const group of plan.plan) {
    for (const release of group) {
      if (release.kind !== 'publish') continue;
      if (!/^\d+\.\d+\.\d+(?:-beta\.\d+)?$/.test(release.version))
        throw new Error(`Unsupported release version: ${release.version}`);
      release.tag = release.version.includes('-beta.') ? 'beta' : 'latest';
    }
  }
  await writeFile(planFile, JSON.stringify(plan, null, 2));
  if (plan.plan.length === 0) console.log('All package versions and tags are already published.');
  else {
    run('pack', '--from-publish-plan', planFile, '--out-dir', artifacts);
    if (process.argv.includes('--dry-run'))
      console.log('Publish plan and artifacts validated; publishing skipped.');
    else run('publish', '--from-pack-dir', artifacts);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
