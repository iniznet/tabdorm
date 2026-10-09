import Dexie, { type Table } from 'dexie';
import type { TabCollection, UnifiedSession } from '@/types';

/** UnifiedSession as persisted — Dexie adds the auto-increment `rev` cursor key. */
export interface StoredSession extends UnifiedSession {
  rev: number;
}

export class TabDormDatabase extends Dexie {
  sessions!: Table<StoredSession, number, UnifiedSession>;
  collections!: Table<TabCollection, number, TabCollection>;

  constructor() {
    super('tabdorm');
    // Schema history — never mutate an existing version; append a new version() block
    // (Expand/Contract) so existing user data upgrades in place.
    this.version(1).stores({
      sessions: '++rev, &id, timestamp, [type+timestamp], contentHash',
    });
    // Step 7: user-curated collections. Expand-only — no existing store mutated.
    this.version(2).stores({
      sessions: '++rev, &id, timestamp, [type+timestamp], contentHash',
      collections: '++rev, &id, updatedAt',
    });
  }
}

/** Singleton database handle. Safe to import from any extension context. */
export const db = new TabDormDatabase();
