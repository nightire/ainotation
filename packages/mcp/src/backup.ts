import { cp, mkdir, readFile, readdir, rename, rm, lstat } from 'node:fs/promises';
import { join, relative, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withOfflineService, feedbackPaths } from './diagnostics';
import { exists } from './recovery-json';
import { writePrivateJson } from './atomic-json';
import { FeedbackStore, parseFeedbackFile } from './store';
import { parseRegistry } from './project-service';
import { ProjectError } from './project';
import { canonicalServiceDirectory } from './service-owner';

const Manifest = z.object({
  version: z.literal(1),
  source: z.string(),
  createdAt: z.string().datetime(),
});
const nested = (parent: string, child: string) => {
  const path = relative(parent, child);
  return !path || (!path.startsWith('..') && !isAbsolute(path));
};
async function noSymlinks(path: string): Promise<void> {
  const info = await lstat(path);
  if (info.isSymbolicLink())
    throw new ProjectError('Backup and restore do not follow symbolic links.');
  if (info.isDirectory())
    for (const entry of await readdir(path)) await noSymlinks(join(path, entry));
}

export async function backupService(directory: string, destination: string, keep = 3) {
  directory = await canonicalServiceDirectory(directory);
  destination = await canonicalServiceDirectory(destination);
  if (nested(directory, destination) || nested(destination, directory))
    throw new ProjectError(
      'Choose a separate backup directory outside the service data directory.',
    );
  if (!Number.isInteger(keep) || keep < 1 || keep > 20)
    throw new ProjectError('Backup retention must be between 1 and 20.');
  return withOfflineService(directory, async () => {
    if (await exists(join(directory, 'restore.pending.json')))
      throw new ProjectError('Finish the interrupted restore before creating another backup.');
    await mkdir(destination, { recursive: true, mode: 0o700 });
    const key = createHash('sha256').update(directory).digest('hex').slice(0, 12);
    const name = `ainotation-${key}-${Date.now()}-${randomUUID()}`;
    const snapshot = join(destination, name);
    await mkdir(snapshot, { mode: 0o700 });
    for (const name of ['projects.json', 'projects.json.backup', 'projects']) {
      const path = join(directory, name);
      if (await exists(path)) {
        await noSymlinks(path);
        await cp(path, join(snapshot, name), { recursive: true, errorOnExist: true, force: false });
      }
    }
    // Written last: incomplete backups are never selected for retention/restore.
    await writePrivateJson(join(snapshot, 'manifest.json'), {
      version: 1,
      source: directory,
      createdAt: new Date().toISOString(),
    });
    const backups: { path: string; createdAt: string }[] = [];
    for (const entry of await readdir(destination, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`ainotation-${key}-`)) continue;
      const path = join(destination, entry.name);
      try {
        const manifest = Manifest.parse(
          JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8')),
        );
        if (manifest.source === directory) backups.push({ path, createdAt: manifest.createdAt });
      } catch {
        /* Unrecognized or incomplete directories are retained. */
      }
    }
    backups.sort((a, b) =>
      a.path === snapshot ? -1 : b.path === snapshot ? 1 : b.createdAt.localeCompare(a.createdAt),
    );
    for (const old of backups.slice(keep)) await rm(old.path, { recursive: true });
    return { snapshot, retained: Math.min(backups.length, keep) };
  });
}

export async function restoreService(directory: string, snapshot: string) {
  directory = await canonicalServiceDirectory(directory);
  snapshot = await canonicalServiceDirectory(snapshot);
  if (nested(directory, snapshot) || nested(snapshot, directory))
    throw new ProjectError('Restore source must be outside the service data directory.');
  await noSymlinks(snapshot);
  Manifest.parse(JSON.parse(await readFile(join(snapshot, 'manifest.json'), 'utf8')));
  parseRegistry(JSON.parse(await readFile(join(snapshot, 'projects.json'), 'utf8')));
  const files = await feedbackPaths(snapshot);
  for (const path of files) parseFeedbackFile(JSON.parse(await readFile(path, 'utf8')));
  return withOfflineService(directory, async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const staging = join(directory, `.restore-${randomUUID()}`);
    const archive = join(directory, `before-restore-${randomUUID()}`);
    await mkdir(staging, { mode: 0o700 });
    for (const name of ['projects.json', 'projects.json.backup', 'projects']) {
      if (await exists(join(snapshot, name)))
        await cp(join(snapshot, name), join(staging, name), { recursive: true });
    }
    for (const path of await feedbackPaths(staging)) {
      const data = parseFeedbackFile(JSON.parse(await readFile(path, 'utf8')));
      await new FeedbackStore(path, data.sessions, randomUUID()).repair(true);
    }
    await mkdir(archive, { mode: 0o700 });
    await writePrivateJson(join(directory, 'restore.pending.json'), { snapshot, staging, archive });
    for (const name of ['connection.json', 'service.lock']) {
      if (await exists(join(directory, name)))
        await rename(join(directory, name), join(archive, name));
    }
    for (const name of ['projects.json', 'projects.json.backup', 'projects']) {
      if (await exists(join(directory, name)))
        await rename(join(directory, name), join(archive, name));
      if (await exists(join(staging, name)))
        await rename(join(staging, name), join(directory, name));
    }
    await rm(staging, { recursive: true });
    await rm(join(directory, 'restore.pending.json'));
    return { restored: snapshot, previousData: archive };
  });
}
