import { db } from './client';

export { db, TabDormDatabase, type StoredSession } from './client';
export * from './sessions';
export { ensureStoragePersistence } from './persist';

import { ensureStoragePersistence } from './persist';

/** One-shot DB bootstrap: durability request + retention-neutral open. */
export async function initDatabase(): Promise<void> {
  await ensureStoragePersistence();
  await db.open();
}
