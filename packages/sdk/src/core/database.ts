import { openDB, type DBSchema, type IDBPDatabase, type OpenDBCallbacks } from 'idb';

/** Bound startup waits, and close any connection delivered after the caller timed out. */
export async function openDatabase<T extends DBSchema>(
  name: string,
  version: number,
  callbacks: OpenDBCallbacks<T>,
  timeoutMs = 3000,
): Promise<IDBPDatabase<T>> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const opening = openDB<T>(name, version, callbacks).then((database) => {
    if (expired) database.close();
    return database;
  });
  try {
    return await Promise.race([
      opening,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(new Error('Local database open timed out'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
