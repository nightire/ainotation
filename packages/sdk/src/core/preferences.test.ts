import { openDB } from 'idb';
import { afterEach, expect, it, vi } from 'vite-plus/test';
import {
  readInspectorPosition,
  writeInspectorPosition,
  readOutputDetail,
  writeOutputDetail,
  readTheme,
  writeTheme,
} from './preferences';

const projects: string[] = [];
const project = () => {
  const id = crypto.randomUUID();
  projects.push(id);
  return id;
};
afterEach(async () => {
  vi.restoreAllMocks();
  const db = await openDB('ainotation-settings', 1);
  try {
    for (const key of projects.splice(0)) {
      localStorage.removeItem(`ainotation:position:${key}`);
      localStorage.removeItem(`ainotation:theme:${key}`);
      await db.delete('preferences', key);
      await db.delete('preferences', ['position', key]);
      await db.delete('preferences', ['theme', key]);
    }
  } finally {
    db.close();
  }
});

it('keeps a new theme authoritative when the localStorage cache cannot be updated', async () => {
  const key = project();
  await writeTheme(key, 'light');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  const writing = writeTheme(key, 'dark');
  expect(await readTheme(key)).toBe('dark');
  await writing;
  expect(await readTheme(key)).toBe('dark');
  // A later page load must not restore a stale cache in preference to IndexedDB.
  expect(localStorage.getItem(`ainotation:theme:${key}`)).toBeNull();
  const db = await openDB('ainotation-settings', 1);
  try {
    expect(await db.get('preferences', ['theme', key])).toBe('dark');
  } finally {
    db.close();
  }
});

it('retains the new preference in memory when both persistence paths fail', async () => {
  const key = project();
  await writeTheme(key, 'light');
  for (const method of ['setItem', 'removeItem'] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new DOMException('Unavailable', 'SecurityError');
    });
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
    throw new DOMException('Full', 'QuotaExceededError');
  });
  await expect(writeTheme(key, 'dark')).rejects.toThrow();
  expect(await readTheme(key)).toBe('dark');
});

it('restores the latest pending position without overwriting output detail or another project', async () => {
  const first = project();
  const other = project();
  await writeOutputDetail(first, 'forensic');
  await writeInspectorPosition(other, { left: 20, top: 30, opensLeft: false });
  const a = writeInspectorPosition(first, { left: 100, top: 150, opensLeft: true });
  const latest = { left: 250, top: 350, opensLeft: false };
  const b = writeInspectorPosition(first, latest);
  expect(JSON.parse(localStorage.getItem(`ainotation:position:${first}`)!)).toEqual(latest);
  expect(await readInspectorPosition(first)).toEqual(latest);
  await Promise.all([a, b]);
  expect(await readInspectorPosition(first)).toEqual(latest);
  expect(await readOutputDetail(first)).toBe('forensic');
  expect(await readInspectorPosition(other)).toEqual({ left: 20, top: 30, opensLeft: false });
});

it('ignores malformed persisted positions and rejects invalid writes', async () => {
  const key = project();
  await writeOutputDetail(key, 'standard');
  const db = await openDB('ainotation-settings', 1);
  try {
    await db.put('preferences', { left: Infinity, top: '10', opensLeft: true }, ['position', key]);
  } finally {
    db.close();
  }
  expect(await readInspectorPosition(key)).toBeUndefined();
  await expect(
    writeInspectorPosition(key, { left: NaN, top: 0, opensLeft: false }),
  ).rejects.toThrow('Invalid inspector position');
});

it('persists the last theme per project while keeping other preferences intact', async () => {
  const first = project();
  const second = project();
  expect(await readTheme(first)).toBe('light');
  await writeOutputDetail(first, 'forensic');
  const position = { left: 40, top: 50, opensLeft: false };
  await writeInspectorPosition(first, position);
  const writes = [
    writeTheme(first, 'dark'),
    writeTheme(first, 'light'),
    writeTheme(first, 'dark'),
    writeTheme(second, 'light'),
  ];
  expect(localStorage.getItem(`ainotation:theme:${first}`)).toBe('dark');
  await Promise.all(writes);
  localStorage.removeItem(`ainotation:theme:${first}`);
  expect(await readTheme(first)).toBe('dark');
  expect(await readTheme(second)).toBe('light');
  expect(await readOutputDetail(first)).toBe('forensic');
  expect(await readInspectorPosition(first)).toEqual(position);
});
