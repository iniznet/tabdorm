import type { CollectionTab, TabCollection } from '@/types';
import { db } from './client';

/** TabCollection as persisted — Dexie adds the auto-increment `rev` cursor key. */
export interface StoredCollection extends TabCollection {
  rev: number;
}

export const DEFAULT_COLLECTION_PAGE_SIZE = 20;

export interface CollectionPage {
  items: TabCollection[];
  nextCursor: number | null;
  hasMore: boolean;
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Math.trunc(limit ?? DEFAULT_COLLECTION_PAGE_SIZE), 1), 100);
}

/** Newest-updated first, cursor paginated — collections are never bulk-loaded. */
export async function pageCollections(options: { limit?: number; cursor?: number } = {}): Promise<CollectionPage> {
  const limit = clampLimit(options.limit);
  const collection =
    options.cursor !== undefined
      ? db.collections.where(':id').below(options.cursor)
      : db.collections.toCollection();
  const rows = (await collection.reverse().limit(limit).toArray()) as StoredCollection[];
  const last = rows.at(-1);
  return { items: rows, nextCursor: last ? last.rev : null, hasMore: rows.length === limit };
}

export async function getCollection(id: string): Promise<TabCollection | undefined> {
  return db.collections.where('id').equals(id).first();
}

export async function putCollection(input: Omit<TabCollection, 'createdAt' | 'updatedAt'> & { createdAt?: number }): Promise<TabCollection> {
  const now = Date.now();
  const existing = await getCollection(input.id);
  const record: TabCollection = {
    ...input,
    createdAt: existing?.createdAt ?? input.createdAt ?? now,
    updatedAt: now,
  };
  await db.collections.put(record);
  return record;
}

export async function deleteCollection(id: string): Promise<void> {
  await db.collections.where('id').equals(id).delete();
}

/**
 * Duplicate detection: returns the collection-tab URLs already present, so the
 * UI can warn before re-adding instead of silently duplicating entries.
 */
export function findDuplicateUrls(collection: TabCollection, incoming: CollectionTab[]): Set<string> {
  const existing = new Set(collection.tabs.map((t) => t.url));
  return new Set(incoming.map((t) => t.url).filter((url) => existing.has(url)));
}