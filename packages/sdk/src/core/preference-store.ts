import type { DBSchema } from 'idb';
import { openDatabase } from './database';

interface SettingsDatabase extends DBSchema {
  preferences: { key: IDBValidKey; value: unknown };
}

async function withDatabase<T>(
  run: (db: Awaited<ReturnType<typeof openDatabase<SettingsDatabase>>>) => Promise<T>,
): Promise<T> {
  const db = await openDatabase<SettingsDatabase>('ainotation-settings', 1, {
    upgrade(database) {
      database.createObjectStore('preferences');
    },
  });
  try {
    return await run(db);
  } finally {
    db.close();
  }
}

/** Preserve existing storage encodings while sharing ordering and fallback rules. */
export function createPreference<T>(options: {
  key: (project: string) => IDBValidKey;
  parse: (value: unknown) => T | undefined;
  cache?: {
    key: (project: string) => string;
    encode: (value: T) => string;
    decode: (value: string) => unknown;
  };
}) {
  const pending = new Map<string, T>();
  const writes = new Map<string, Promise<void>>();
  const immediate = (project: string): T | undefined => {
    if (options.cache) {
      try {
        const raw = localStorage.getItem(options.cache.key(project));
        const value = raw === null ? undefined : options.parse(options.cache.decode(raw));
        if (value !== undefined) return value;
      } catch {
        /* Keep working with IndexedDB or the pending in-memory value. */
      }
    }
    return pending.get(project);
  };
  return {
    async read(project: string): Promise<T | undefined> {
      const cached = immediate(project);
      if (cached !== undefined) return structuredClone(cached);
      try {
        const stored = await withDatabase((db) => db.get('preferences', options.key(project)));
        return structuredClone(immediate(project) ?? options.parse(stored));
      } catch {
        return structuredClone(immediate(project));
      }
    },
    write(project: string, value: T): Promise<void> {
      const parsed = options.parse(value);
      if (parsed === undefined) return Promise.reject(new Error('Invalid preference value'));
      const snapshot = structuredClone(parsed);
      pending.set(project, snapshot);
      let cached = false;
      if (options.cache) {
        try {
          localStorage.setItem(options.cache.key(project), options.cache.encode(snapshot));
          cached = true;
        } catch {
          /* IndexedDB can still persist this change. */
        }
      }
      const work = (writes.get(project) ?? Promise.resolve())
        .catch(() => {})
        .then(async () => {
          try {
            await withDatabase((db) => db.put('preferences', snapshot, options.key(project)));
          } catch (error) {
            if (!cached) throw error;
          }
          if (pending.get(project) === snapshot) pending.delete(project);
        });
      writes.set(project, work);
      const settled = () => {
        if (writes.get(project) === work) writes.delete(project);
      };
      void work.then(settled, settled);
      return work;
    },
  };
}
