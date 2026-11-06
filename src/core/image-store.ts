import { db } from './db/client';
import { pickPageThumbs, selectExpired, selectOverBudget, ttlMsOf } from './image-cache';
import { promoteSessionRow, selectSessionOverBudget } from './image-session';
import type {
  CachedImage,
  CachedSessionImage,
  GalleryImage,
  ImageCacheConfig,
  ImageCacheTotals,
  ImageClearResult,
  ImageHostStat,
} from '@/types';

/**
 * Dexie access for the pinned image cache. Blobs live in IndexedDB, never in
 * `chrome.storage.local`: that tier caps at 10 MB without `unlimitedStorage`
 * and serializes every value to JSON.
 */

/** Store name inside the shared `tabdorm` database. */
export const IMAGE_TABLE = 'images';

/** Session band store name: rows that die with their tab. */
export const SESSION_IMAGE_TABLE = 'sessionImages';

/* ------------------------------------------------------------------ session */

/** Inserts or replaces one session row. */
export async function putSessionImage(row: CachedSessionImage): Promise<void> {
  await db.sessionImages.put(row);
}

/** That tab's session rows, newest first. */
export async function sessionRowsForTab(tabId: number): Promise<CachedSessionImage[]> {
  const rows = await db.sessionImages.where('tabId').equals(tabId).toArray();
  return rows.sort((left, right) => right.savedAt - left.savedAt);
}

/** Session band totals, kept separate from the offline readout. */
export async function sessionTotals(): Promise<ImageCacheTotals> {
  let count = 0;
  let bytes = 0;
  await db.sessionImages.each((row) => {
    count += 1;
    bytes += row.size;
  });
  return { count, bytes };
}

/** Drops one closed tab's rows and reports how many went. */
export async function purgeTabSessions(tabId: number): Promise<number> {
  const keys = await db.sessionImages.where('tabId').equals(tabId).primaryKeys();
  if (keys.length === 0) return 0;
  await db.sessionImages.bulkDelete(keys);
  return keys.length;
}

/** Empties the session band. Runs at browser start, where every tab is new. */
export async function clearSessionImages(): Promise<ImageClearResult> {
  let bytes = 0;
  let count = 0;
  await db.sessionImages.each((row) => {
    count += 1;
    bytes += row.size;
  });
  if (count > 0) await db.sessionImages.clear();
  return { removed: count, bytes };
}

/**
 * Budget eviction for the session band. No TTL applies: a session row is bounded
 * by its tab's life, not by time.
 */
export async function sweepSessionImages(
  config: ImageCacheConfig,
): Promise<{ evicted: number }> {
  const rows = await db.sessionImages.toArray();
  if (rows.length === 0) return { evicted: 0 };
  const evicted = selectSessionOverBudget(rows, config);
  if (evicted.length > 0) await db.sessionImages.bulkDelete(evicted);
  return { evicted: evicted.length };
}

/**
 * Promotes one tab's session rows into the offline store and removes them in the
 * same transaction, so a crash cannot leave the bytes in both bands.
 */
export async function promoteTabSessions(tabId: number, now: number): Promise<number> {
  const rows = await sessionRowsForTab(tabId);
  if (rows.length === 0) return 0;
  const promoted = rows.map((row) => promoteSessionRow(row, now));
  await db.transaction('rw', db.images, db.sessionImages, async () => {
    await db.images.bulkPut(promoted);
    await db.sessionImages.bulkDelete(rows.map((row) => row.key));
  });
  return promoted.length;
}

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

/** Offline totals. IndexedDB stores blobs out of line, so this reads metadata only. */
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
  // The session band is cleared with the same action, so a reader who clears one
  // site never has to guess which band still holds its bytes.
  const sessionKeys = await db.sessionImages.where('host').equals(host).primaryKeys();
  for (const key of sessionKeys) {
    const row = await db.sessionImages.get(key);
    if (row !== undefined) bytes += row.size;
  }
  count += sessionKeys.length;
  if (sessionKeys.length > 0) await db.sessionImages.bulkDelete(sessionKeys);
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
  const session = await clearSessionImages();
  return { removed: count + session.removed, bytes: bytes + session.bytes };
}

/**
 * One page of the Options gallery, newest first. Metadata and bytes arrive
 * together because the grid paints the record it just read, and the `savedAt`
 * index carries the slice so the read never walks the whole store.
 */
/** Newest rows one tab-list refresh may scan. A large cache must not stall a panel. */
const THUMB_SCAN_ROWS = 400;

/**
 * One record per page url, newest first, for the thumbnail on a sleeping tab row.
 * Read-only: pages with nothing cached are simply absent.
 */
export async function imageThumbsForPages(
  pageUrls: readonly string[],
): Promise<Map<string, CachedImage>> {
  const wanted = [...new Set(pageUrls.filter((url) => url !== ''))];
  const found = new Map<string, CachedImage>();
  if (wanted.length === 0) return found;
  const rows = await db.images.orderBy('savedAt').reverse().limit(THUMB_SCAN_ROWS).toArray();
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const [page, key] of pickPageThumbs(rows, wanted)) {
    const row = byKey.get(key);
    if (row !== undefined) found.set(page, row);
  }
  return found;
}

/** Rows in both bands, so the grid can size itself before it pages. */
export async function imageGalleryCount(): Promise<number> {
  const [session, offline] = await Promise.all([db.sessionImages.count(), db.images.count()]);
  return session + offline;
}

/**
 * One page of the Options gallery: session rows first because they are the
 * newest and the ones a reader just saw, then offline rows. Each row carries its
 * band so the grid can tag it.
 */
export async function imageGalleryPage(offset: number, limit: number): Promise<GalleryImage[]> {
  if (limit <= 0) return [];
  const start = Math.max(0, offset);
  const out: GalleryImage[] = [];
  const session = await db.sessionImages.orderBy('savedAt').reverse().toArray();
  for (let index = start; index < session.length && out.length < limit; index += 1) {
    const row = session[index];
    if (row !== undefined) out.push({ ...promoteSessionRow(row, row.savedAt), origin: 'session' });
  }
  if (out.length >= limit) return out;
  const offlineOffset = Math.max(0, start - session.length);
  const offline = await db.images
    .orderBy('savedAt')
    .reverse()
    .offset(offlineOffset)
    .limit(limit - out.length)
    .toArray();
  for (const row of offline) out.push({ ...row, origin: 'offline' });
  return out;
}
