import { db } from './db/client';
import { selectExpired, selectOverBudget, ttlMsOf } from './image-cache';
import type { CachedImage, ImageCacheConfig, ImageCacheTotals, ImageClearResult, ImageHostStat } from '@/types';

/**
 * Dexie access for the pinned image cache. Blobs live in IndexedDB, never in
 * `chrome.storage.local`: that tier caps at 10 MB without `unlimitedStorage`
 * and serializes every value to JSON.
 */

/** Store name inside the shared `tabdorm` database. */
export const IMAGE_TABLE = 'images';

/** Inserts or replaces one record. */
export async function putImage(record: CachedImage): Promise<void> {
  await db.images.put(record);
}

/** Reads the records for the given keys, skipping misses. */
export async function readImages(keys: readonly string[]): Promise<CachedImage[]> {
  if (keys.length === 0) return [];
  const rows = await db.images.bulkGet([...keys]);
  return rows.filter((row): row is CachedImage => row !== undefined);
}

/** Stamps `lastUsed` so LRU eviction keeps what the user actually sees. */
export async function touchImages(keys: readonly string[], now: number): Promise<void> {
  if (keys.length === 0) return;
  await db.images.bulkUpdate(keys.map((key) => ({ key, changes: { lastUsed: now } })));
}

/** Whole-store totals. IndexedDB stores blobs out of line, so this reads metadata only. */
export async function imageTotals(): Promise<ImageCacheTotals> {
  let count = 0;
  let bytes = 0;
  await db.images.each((row) => {
    count += 1;
    bytes += row.size;
  });
  return { count, bytes };
}

/** Per-host breakdown for the Options readout, largest first. */
export async function imageHostStats(): Promise<ImageHostStat[]> {
  const stats = new Map<string, ImageHostStat>();
  await db.images.each((row) => {
    const existing = stats.get(row.host);
    if (existing === undefined) {
      stats.set(row.host, { host: row.host, count: 1, bytes: row.size, newestSavedAt: row.savedAt });
      return;
    }
    existing.count += 1;
    existing.bytes += row.size;
    existing.newestSavedAt = Math.max(existing.newestSavedAt, row.savedAt);
  });
  return [...stats.values()].sort((left, right) => right.bytes - left.bytes);
}

/**
 * TTL sweep, then LRU eviction against the byte budget. Both rules stay pure in
 * `image-cache.ts`; this function only carries them to Dexie.
 */
export async function sweepImages(
  config: ImageCacheConfig,
  now: number,
): Promise<{ expired: number; evicted: number }> {
  const rows = await db.images.toArray();
  if (rows.length === 0) return { expired: 0, evicted: 0 };
  const expired = selectExpired(rows, now, ttlMsOf(config));
  if (expired.length > 0) await db.images.bulkDelete(expired);
  const expiredSet = new Set(expired);
  const kept = rows.filter((row) => !expiredSet.has(row.key));
  const evicted = selectOverBudget(kept, config.maxMegabytes * 1024 * 1024);
  if (evicted.length > 0) await db.images.bulkDelete(evicted);
  return { expired: expired.length, evicted: evicted.length };
}

/** Totals plus byte count for a clear action's report. */
export async function clearImagesForHost(host: string): Promise<ImageClearResult> {
  let bytes = 0;
  let count = 0;
  await db.images.where('host').equals(host).each((row) => {
    count += 1;
    bytes += row.size;
  });
  if (count > 0) await db.images.where('host').equals(host).delete();
  return { removed: count, bytes };
}

/** Clears the whole store and reports what went. */
export async function clearAllImages(): Promise<ImageClearResult> {
  let bytes = 0;
  let count = 0;
  await db.images.each((row) => {
    count += 1;
    bytes += row.size;
  });
  if (count > 0) await db.images.clear();
  return { removed: count, bytes };
}
