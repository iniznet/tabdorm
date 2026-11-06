import { getConfig } from './config-store';
import { normalizeImageKey, ttlMsOf } from './image-cache';
import { readImages, touchImages } from './image-store';
import type { CachedImage, TabDormConfig } from '@/types';

/**
 * Worker half of the replay path. The page script (`public/image-cache.js`) owns
 * the DOM; this module owns the lookup, the TTL check, and the bytes.
 *
 * Data URLs, not object URLs: `chrome.runtime` messaging is JSON, so a Blob does
 * not survive it, and a service worker cannot mint a blob URL a page may load.
 */

const SCRIPT_ID = 'tabdorm-image-cache';

/** Keys per lookup: the page caps its own request at the same number. */
const MAX_KEYS = 60;

/** Ceiling for one response, so a heavy page cannot stall its own renderer. */
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;

/** base64 of a byte array, chunked so no spread argument list gets huge. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8_192;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

async function toDataUrl(record: CachedImage): Promise<string | null> {
  try {
    const buffer = await record.blob.arrayBuffer();
    return `data:${record.mime};base64,${toBase64(new Uint8Array(buffer))}`;
  } catch {
    return null;
  }
}

/**
 * Registers or removes the replay page script. Mirrors `applyFormGuardSync`:
 * registration is never attempted without the optional grant, and the script
 * file is a plain asset in `public/`, because a runtime-registered file needs no
 * web-accessible declaration.
 */
export async function applyImageCacheSync(config: TabDormConfig): Promise<void> {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const exists = registered.some((script) => script.id === SCRIPT_ID);
    if (!config.images.enabled) {
      if (exists) await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
      return;
    }
    const granted = await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) return;
    if (exists) return;
    await chrome.scripting.registerContentScripts([{
      id: SCRIPT_ID,
      matches: ['<all_urls>'],
      js: ['image-cache.js'],
      runAt: 'document_start',
      // A viewer can paint its pictures inside a subframe, so every frame is
      // covered. Each frame keeps its own announce caps.
      allFrames: true,
      persistAcrossSessions: true,
    }]);
  } catch (error) {
    console.warn('[tabdorm] image cache script sync failed.', error);
  }
}

/**
 * Resolves the page's candidate keys against the store and returns the
 * unexpired ones as data URLs. Unknown, expired, and oversized entries are
 * skipped, so the page falls back to the network for them.
 */
export async function lookupCachedImages(
  pageUrl: string,
  rawKeys: readonly string[],
  config: TabDormConfig,
): Promise<Record<string, string>> {
  const images: Record<string, string> = {};
  if (!config.images.enabled) return images;

  const keys: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawKeys.slice(0, MAX_KEYS)) {
    const key = normalizeImageKey(raw, pageUrl);
    if (key === null || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  if (keys.length === 0) return images;

  const records = await readImages(keys);
  if (records.length === 0) return images;

  const now = Date.now();
  const ttlMs = ttlMsOf(config.images);
  const served: string[] = [];
  let payload = 0;

  for (const record of records) {
    // TTL on read, not only on sweep: a stalled sweep must not serve stale bytes.
    if (now - record.savedAt >= ttlMs) continue;
    const dataUrl = await toDataUrl(record);
    if (dataUrl === null) continue;
    if (payload + dataUrl.length > MAX_PAYLOAD_BYTES) break;
    payload += dataUrl.length;
    images[record.key] = dataUrl;
    served.push(record.key);
  }

  if (served.length > 0) {
    await touchImages(served, now).catch(() => undefined);
  }
  return images;
}
