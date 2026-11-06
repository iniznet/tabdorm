import Dexie, { type Table } from 'dexie';
import type { CachedImage, CachedSessionImage, TabCollection, UnifiedSession } from '@/types';

/** UnifiedSession as persisted — Dexie adds the auto-increment `rev` cursor key. */
export interface StoredSession extends UnifiedSession {
  rev: number;
}

export class TabDormDatabase extends Dexie {
  sessions!: Table<StoredSession, number, UnifiedSession>;
  collections!: Table<TabCollection, number, TabCollection>;
  images!: Table<CachedImage, string, CachedImage>;
  sessionImages!: Table<CachedSessionImage, string, CachedSessionImage>;

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
    // Pinned image cache for suspended tabs. Keys are absolute image URLs, never
    // tab ids: a record outlives a restart and tab ids are reused. `host` carries
    // the scoped clear; `savedAt` the TTL, `lastUsed` the LRU budget.
    this.version(3).stores({
      sessions: '++rev, &id, timestamp, [type+timestamp], contentHash',
      collections: '++rev, &id, updatedAt',
      images: '&key, savedAt, lastUsed, host',
    });
    // Session band: the same bytes while their tab is still open. Keyed by tab
    // through `tabId` so a close deletes one range, and promoted into `images`
    // at suspend. Replay never reads this table.
    this.version(4).stores({
      sessions: '++rev, &id, timestamp, [type+timestamp], contentHash',
      collections: '++rev, &id, updatedAt',
      images: '&key, savedAt, lastUsed, host',
      sessionImages: '&key, tabId, host, savedAt, lastUsed',
    });
  }
}

/** Singleton database handle. Safe to import from any extension context. */
export const db = new TabDormDatabase();
