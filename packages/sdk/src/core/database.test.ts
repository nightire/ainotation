import { openDB, deleteDB, type DBSchema } from 'idb';
import { expect, it } from 'vite-plus/test';
import { openDatabase } from './database';

interface Database extends DBSchema {
  values: { key: string; value: string };
}

it('times out a blocked upgrade and closes the connection if it opens later', async () => {
  const name = `ainotation-database-test-${crypto.randomUUID()}`;
  const previous = await openDB<Database>(name, 1, {
    upgrade(db) {
      db.createObjectStore('values');
    },
  });
  try {
    const opening = openDatabase<Database>(name, 2, {}, 20);
    await expect(opening).rejects.toThrow('Local database open timed out');
  } finally {
    previous.close();
    // Deletion completes only if the late-opened upgrade connection was released.
    await deleteDB(name);
  }
});
