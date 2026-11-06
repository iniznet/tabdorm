import { getConfig } from './config-store';
import { hostOfUrl, isCacheableImageUrl, normalizeImageKey } from './image-cache';
import { makePreview } from './image-capture';
import {
  contentLengthRefused,
  refuseReason,
  sessionKey,
  shouldCaptureSize,
  shouldWriteSessionRow,
  sniffImageMime,
} from './image-session';
import { putSessionImage, readImages, sweepSessionImages, touchImages } from './image-store';
import type { AnnouncedImage } from '@/types/messages';
import type { CachedSessionImage, ImageCacheConfig } from '@/types';

/**
 * Awake-time capture: the page announces each picture it loads, and this module
 * reads the bytes once into the session band. The row dies with its tab, and
 * `discardTabSafe` promotes it into the offline store at suspend.
 *
 * Every path is best-effort. A refused request, a page that closes mid-read, a
 * CDN answering HTML, or a feature switched off all degrade to "nothing kept";
 * a suspension never waits on this work.
 */

/** Reads in flight. Two is enough for a normal page and polite on a CDN. */
const MAX_PARALLEL = 2;

/** One read's ceiling, whatever the config says: a single picture past this is
 *  not an image a page renders, and reading it whole would spike the worker. */
const HARD_READ_BYTES = 64 * 1024 * 1024;

/** Below this size the gallery paints the original, so a preview would be waste. */
const PREVIEW_FROM_BYTES = 128 * 1024;

/** A read gives up here, so a stalled CDN cannot pin a queue slot. */
const READ_TIMEOUT_MS = 8_000;

/** Magic-byte prefix needed by `sniffImageMime`. */
const SNIFF_BYTES = 16;

interface CaptureTarget {
  key: string;
  kind: AnnouncedImage['kind'];
}

/** Candidates worth reading, in the order the page announced them. */
function pickTargets(
  items: readonly AnnouncedImage[],
  pageUrl: string,
  context: { incognito: boolean; discarded: boolean },
  config: ImageCacheConfig,
): CaptureTarget[] {
  const seen = new Set<string>();
  const targets: CaptureTarget[] = [];
  for (const item of items) {
    const key = normalizeImageKey(item.src, pageUrl);
    if (key === null || seen.has(key)) continue;
    if (refuseReason(key, context, config) !== null) continue;
    // A rendered box proves the picture matters; without one the byte floor in
    // `shouldCaptureSize` decides after the read.
    if (item.kind === 'img' && !isCacheableImageUrl(item.src, pageUrl, item.pixels, config)) continue;
    seen.add(key);
    targets.push({ key, kind: item.kind });
  }
  return targets;
}

/** Reads one picture, or null when it is not worth a session row. */
async function readOne(
  key: string,
  host: string,
  pageUrl: string,
  tabId: number,
  config: ImageCacheConfig,
): Promise<CachedSessionImage | null> {
  try {
    const response = await fetch(key, {
      credentials: 'include',
      // The page already downloaded these bytes, so a second read comes off the
      // HTTP cache instead of the network.
      cache: 'force-cache',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const declared = Number(response.headers.get('content-length') ?? '');
    if (contentLengthRefused(declared, config, HARD_READ_BYTES)) return null;
    const blob = await response.blob();
    if (blob.size > HARD_READ_BYTES) return null;
    if (!shouldCaptureSize(blob.size, config)) return null;
    const header = new Uint8Array(await blob.slice(0, SNIFF_BYTES).arrayBuffer());
    const mime = sniffImageMime(response.headers.get('content-type') ?? blob.type, header);
    if (mime === null) return null;
    // The tab may have closed while the bytes were in flight: the close purge
    // already ran, and a late write would leave a row nothing ever deletes.
    try {
      await chrome.tabs.get(tabId);
    } catch {
      return null;
    }
    const now = Date.now();
    const preview = blob.size >= PREVIEW_FROM_BYTES ? await makePreview(blob) : null;
    const row: CachedSessionImage = {
      key: sessionKey(tabId, key),
      tabId,
      imageKey: key,
      host,
      pageUrl,
      mime,
      size: blob.size,
      savedAt: now,
      lastUsed: now,
      blob,
    };
    if (preview !== null) row.preview = preview;
    return row;
  } catch {
    return null;
  }
}

/**
 * Stores the pictures one page announced. Returns how many session rows were
 * written. A key the offline store already holds is touched, never copied.
 */
export async function captureAnnouncedImages(
  tabId: number,
  pageUrl: string,
  items: readonly AnnouncedImage[],
): Promise<number> {
  const config = await getConfig();
  if (!config.images.enabled || !config.images.autoCapture) return 0;
  if (items.length === 0) return 0;
  const host = hostOfUrl(pageUrl);
  if (host === null) return 0;

  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return 0;
  }
  const context = { incognito: tab.incognito === true, discarded: tab.discarded === true };
  const targets = pickTargets(items, pageUrl, context, config.images);
  if (targets.length === 0) return 0;

  // A picture already kept offline is warm, not new: touch it and skip the read,
  // so an awake page that reloads its own gallery never doubles the bytes.
  const held = new Set((await readImages(targets.map((target) => target.key))).map((row) => row.key));
  const touched = targets.filter((target) => !shouldWriteSessionRow(held.has(target.key)));
  if (touched.length > 0) await touchImages(touched.map((target) => target.key), Date.now());
  const fresh = targets.filter((target) => shouldWriteSessionRow(held.has(target.key)));
  if (fresh.length === 0) return 0;

  let saved = 0;
  let cursor = 0;
  const runner = async (): Promise<void> => {
    for (;;) {
      const target = fresh[cursor];
      cursor += 1;
      if (target === undefined) return;
      const row = await readOne(target.key, host, pageUrl, tabId, config.images);
      if (row === null) continue;
      try {
        await putSessionImage(row);
        saved += 1;
      } catch (error) {
        console.warn('[tabdorm] session image write failed.', error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, fresh.length) }, runner));

  try {
    await sweepSessionImages(config.images);
  } catch (error) {
    console.warn('[tabdorm] session image sweep failed.', error);
  }
  return saved;
}
