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

/**
 * Post-fetch filter: an empty body or one image past the ceiling is refused.
 * A ceiling of zero means "no ceiling", matching the byte budget: a real picture
 * runs 1-10 MB, so a size cap is a choice, never a safety net.
 */
export function exceedsByteCeiling(bytes: number, config: ImageCacheConfig): boolean {
  if (!Number.isFinite(bytes) || bytes <= 0) return true;
  if (config.maxImageKilobytes <= 0) return false;
  return bytes > config.maxImageKilobytes * 1024;
}

/** What the selection rules need from a page candidate. */
export interface SizedCandidate {
  pixels: number;
}

/**
 * The candidates worth spending the capture budget on, biggest first.
 *
 * Page order is not importance: avatars, icons, and sprite sheets sit near the
 * top of the DOM on most sites, and the fetch budget is 1500 ms. Sorting by
 * rendered area puts the pictures a reader would name first, and a stable sort
 * keeps page order inside a tie so two runs pick the same bytes.
 */
export function selectCaptureCandidates<T extends SizedCandidate>(
  candidates: readonly T[],
  limit: number,
): T[] {
  const usable = candidates.filter((candidate) => Number.isFinite(candidate.pixels) && candidate.pixels > 0);
  if (limit <= 0) return [];
  return usable
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => right.candidate.pixels - left.candidate.pixels || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** The fields the tab-list thumb picker needs from a cached row. */
export interface PageImageRow {
  key: string;
  pageUrl: string;
  savedAt: number;
}

/**
 * One image per page, newest first, for the sidepanel tab list. A page with no
 * cached row is absent from the map, so its row renders without a thumbnail.
 */
export function pickPageThumbs(
  rows: readonly PageImageRow[],
  wanted: readonly string[],
): Map<string, string> {
  const pages = new Set(wanted);
  const picked = new Map<string, PageImageRow>();
  for (const row of rows) {
    if (!pages.has(row.pageUrl)) continue;
    const current = picked.get(row.pageUrl);
    if (current === undefined || row.savedAt > current.savedAt) picked.set(row.pageUrl, row);
  }
  return new Map([...picked].map(([page, row]) => [page, row.key]));
}

/**
 * Scaled box that keeps an aspect ratio inside `maxEdge`. Never upscales: a
 * small image is returned at its own size, so a tile is not stretched into
 * blur. Invalid input collapses to 0x0, and callers treat that as "no preview".
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || maxEdge <= 0) {
    return { width: 0, height: 0 };
  }
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Key for bytes harvested from a page-created `blob:` url, which a worker can
 * never fetch. Deliberately not a url, and never normalized: the replay script
 * matches page urls, so this record feeds the gallery and the thumbnail only.
 * The digest makes a re-capture of the same picture overwrite itself, not pile up.
 */
export function blobImageKey(digest: string): string {
  return `blob-sha256:${digest}`;
}

/** Human byte size for readouts: `0 B`, `940 B`, `12.4 KB`, `1.8 MB`. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1_024) return `${Math.round(bytes)} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

/**
 * Pure: the next slice a "load more" grid fetches, given how many rows it already
 * holds. The limit is clamped to what is left, so a store that shrank since the
 * first read never hands back a key the grid already shows. A duplicate key in a
 * keyed list is a render error, not a redundant tile.
 */
export function nextGalleryWindow(
  total: number,
  shown: number,
  pageSize: number,
): { offset: number; limit: number } {
  if (pageSize <= 0 || total <= 0) return { offset: 0, limit: 0 };
  const offset = Math.max(0, Math.min(shown, total));
  return { offset, limit: Math.max(0, Math.min(pageSize, total - offset)) };
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
  // Zero or below means "no byte cap": the TTL is the only bound, so eviction
  // never runs and nothing is dropped for being large.
  if (budgetBytes <= 0) return [];
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
