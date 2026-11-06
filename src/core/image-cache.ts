import type { ImageCacheConfig } from '@/types';

/**
 * Pure decisions for the pinned image cache. No chrome API, no Dexie — every
 * rule here is testable in plain node.
 */

const CACHEABLE_SCHEMES: readonly string[] = ['http:', 'https:'];

/** Smallest record shape the selection rules need. */
export interface TimedImageRecord {
  key: string;
  size: number;
  savedAt: number;
  lastUsed: number;
}

/**
 * Absolute http(s) URL without its fragment, or null for anything else.
 *
 * The query is kept: signed CDN URLs differ only there, and dropping it would
 * serve one image's bytes for another. `data:`, `blob:`, `filesystem:`, and
 * extension schemes resolve to null so no extension resource can be captured.
 */
export function normalizeImageKey(rawUrl: string, baseUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl, baseUrl);
  } catch {
    return null;
  }
  if (!CACHEABLE_SCHEMES.includes(url.protocol)) return null;
  url.hash = '';
  return url.toString();
}

/** Host of an http(s) URL, or null. */
export function hostOfUrl(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  return CACHEABLE_SCHEMES.includes(url.protocol) ? url.host : null;
}

/**
 * Pre-fetch filter: a cacheable scheme plus a rendered area at or above the
 * pixel floor. Tracking pixels, spacers, and icons fall below it; an image with
 * no measured box yet reports 0 and is skipped.
 */
export function isCacheableImageUrl(
  rawUrl: string,
  baseUrl: string,
  pixels: number,
  config: ImageCacheConfig,
): boolean {
  if (normalizeImageKey(rawUrl, baseUrl) === null) return false;
  if (!Number.isFinite(pixels) || pixels < config.minPixels) return false;
  return true;
}

/** Post-fetch filter: an empty body or one image past the ceiling is refused. */
export function exceedsByteCeiling(bytes: number, config: ImageCacheConfig): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return true;
  return bytes > config.maxImageKilobytes * 1024;
}

/** The configured TTL in milliseconds. */
export function ttlMsOf(config: ImageCacheConfig): number {
  return config.ttlMinutes * 60_000;
}

/** Keys at or past their TTL. The boundary is inclusive: exactly expired is expired. */
export function selectExpired(
  records: readonly TimedImageRecord[],
  now: number,
  ttlMs: number,
): string[] {
  const expired: string[] = [];
  for (const record of records) {
    if (now - record.savedAt >= ttlMs) expired.push(record.key);
  }
  return expired;
}

/**
 * Keys to drop so the store fits its byte budget, least recently used first.
 * Order is total, so the same input always drops the same keys.
 */
export function selectOverBudget(
  records: readonly TimedImageRecord[],
  budgetBytes: number,
): string[] {
  let total = 0;
  for (const record of records) total += record.size;
  if (total <= budgetBytes) return [];
  const ordered = [...records].sort(
    (left, right) => left.lastUsed - right.lastUsed || left.key.localeCompare(right.key),
  );
  const dropped: string[] = [];
  let remaining = total;
  for (const record of ordered) {
    if (remaining <= budgetBytes) break;
    dropped.push(record.key);
    remaining -= record.size;
  }
  return dropped;
}
