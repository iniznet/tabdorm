import type { CachedImage, CachedSessionImage, ImageCacheConfig } from '@/types';

/**
 * Pure decisions for the session band of the image cache. No chrome API, no
 * Dexie, no clock: every rule here is testable in plain node.
 *
 * A session row lives only as long as its tab. At suspend it is promoted into
 * the offline store, which is the band replay and the gallery already read, so
 * this module never decides what a restored page sees.
 */

/** Smallest row shape the session budget rules need. */
export interface TimedSessionRecord {
  key: string;
  tabId: number;
  size: number;
  lastUsed: number;
}

/** Composite key: tab identity first, so one tab's rows delete in one range. */
export function sessionKey(tabId: number, imageKey: string): string {
  return `${tabId}:${imageKey}`;
}

/** Tab that owns a session key, or null when the key is not shaped like one. */
export function tabOfSessionKey(key: string): number | null {
  const cut = key.indexOf(':');
  if (cut <= 0) return null;
  const id = Number(key.slice(0, cut));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Post-read filter for a candidate captured without a rendered box: a byte floor
 * keeps tracking pixels and spacers out where pixel area cannot, and the size
 * ceiling still applies. Zero bytes is never a picture.
 */
export function shouldCaptureSize(bytes: number, config: ImageCacheConfig): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return false;
  if (bytes < config.minBytes) return false;
  if (config.maxImageKilobytes <= 0) return true;
  return bytes <= config.maxImageKilobytes * 1024;
}

/**
 * Refuses a response from its declared length, before the body is read. An
 * unknown or zero length is not a refusal: the body then decides in
 * `shouldCaptureSize`, and `hardCapBytes` still bounds the read itself.
 */
export function contentLengthRefused(
  declaredLength: number,
  config: ImageCacheConfig,
  hardCapBytes: number,
): boolean {
  if (!Number.isFinite(declaredLength) || declaredLength <= 0) return false;
  if (declaredLength > hardCapBytes) return true;
  if (config.maxImageKilobytes <= 0) return false;
  return declaredLength > config.maxImageKilobytes * 1024;
}

/**
 * A key already in the offline store is never copied into the session band. The
 * caller touches it instead, so an awake page that reloads its pictures cannot
 * double the bytes, and a wake never demotes a row.
 */
export function shouldWriteSessionRow(offlineExists: boolean): boolean {
  return !offlineExists;
}

/** LRU order, total: the same input always drops the same keys. */
function byLru(left: TimedSessionRecord, right: TimedSessionRecord): number {
  return left.lastUsed - right.lastUsed || left.key.localeCompare(right.key);
}

/**
 * Keys to drop so the session band fits: the per-tab count cap first, then the
 * global byte budget, least recently used first. A cap of zero means no cap.
 */
export function selectSessionOverBudget(
  rows: readonly TimedSessionRecord[],
  config: ImageCacheConfig,
): string[] {
  const dropped = new Set<string>();
  const maxImages = config.sessionMaxImages;
  if (maxImages > 0) {
    const byTab = new Map<number, TimedSessionRecord[]>();
    for (const row of rows) {
      const list = byTab.get(row.tabId);
      if (list === undefined) byTab.set(row.tabId, [row]);
      else list.push(row);
    }
    for (const list of byTab.values()) {
      if (list.length <= maxImages) continue;
      const ordered = [...list].sort(byLru);
      for (const row of ordered.slice(0, ordered.length - maxImages)) dropped.add(row.key);
    }
  }
  const budget = config.sessionMaxMegabytes * 1024 * 1024;
  if (budget > 0) {
    const kept = rows.filter((row) => !dropped.has(row.key));
    let total = 0;
    for (const row of kept) total += row.size;
    for (const row of [...kept].sort(byLru)) {
      if (total <= budget) break;
      dropped.add(row.key);
      total -= row.size;
    }
  }
  return [...dropped].sort();
}

/** Session keys one closed tab leaves behind. */
export function purgeRowsForTab(rows: readonly { key: string; tabId: number }[], tabId: number): string[] {
  return rows.filter((row) => row.tabId === tabId).map((row) => row.key);
}

/**
 * Promotion is a move, never a copy. `savedAt` restarts at the sleep moment,
 * because that is what the offline TTL is measured from, and the row arrives
 * warm with `lastUsed` at the same instant.
 */
export function promoteSessionRow(row: CachedSessionImage, now: number): CachedImage {
  const promoted: CachedImage = {
    key: row.imageKey,
    host: row.host,
    pageUrl: row.pageUrl,
    mime: row.mime,
    size: row.size,
    savedAt: now,
    lastUsed: now,
    blob: row.blob,
  };
  if (row.preview !== undefined) promoted.preview = row.preview;
  return promoted;
}

/** Whatever context a candidate arrives with. */
export interface CaptureContext {
  incognito: boolean;
  discarded: boolean;
}

/**
 * Why one announced candidate is refused, or null when it may be read. Scheme
 * and credential checks happen here so no caller can skip them.
 */
export function refuseReason(
  url: string,
  context: CaptureContext,
  config: ImageCacheConfig,
): string | null {
  if (!config.enabled || !config.autoCapture) return 'disabled';
  if (context.incognito) return 'incognito';
  if (context.discarded) return 'discarded';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'invalid_url';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'scheme';
  if (parsed.username !== '' || parsed.password !== '') return 'credentials';
  return null;
}

/**
 * Image mime from the bytes on the wire, so a CDN that answers
 * `application/octet-stream` still lands in the cache with a usable type.
 * A declared `image/*` wins; anything else must prove itself by magic bytes.
 */
export function sniffImageMime(declaredHeader: string, bytes: Uint8Array): string | null {
  const declared = (declaredHeader.split(';')[0] ?? '').trim().toLowerCase();
  if (declared.startsWith('image/')) return declared;
  const at = (offset: number): number => bytes[offset] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return 'image/png';
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return 'image/gif';
  if (at(0) === 0x52 && at(1) === 0x49 && at(2) === 0x46 && at(3) === 0x46 && at(8) === 0x57 && at(9) === 0x45 && at(10) === 0x42 && at(11) === 0x50) {
    return 'image/webp';
  }
  if (at(4) === 0x66 && at(5) === 0x74 && at(6) === 0x79 && at(7) === 0x70) {
    const brand = String.fromCharCode(at(8), at(9), at(10), at(11));
    return brand.startsWith('avi') ? 'image/avif' : null;
  }
  if (at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp';
  return null;
}
