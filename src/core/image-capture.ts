import { getConfig } from './config-store';
import {
  exceedsByteCeiling,
  fitWithin,
  hostOfUrl,
  isCacheableImageUrl,
  normalizeImageKey,
  selectCaptureCandidates,
} from './image-cache';
import { putImage, readImages } from './image-store';
import type { CachedImage, ImageCacheConfig } from '@/types';

/**
 * Capture runs immediately before a tab is discarded, from the single discard
 * funnel (`discardTabSafe`): a discarded tab has no renderer left to read a DOM
 * from, and every suspend source already funnels through that call.
 *
 * Every path is best-effort. A missing optional grant, a page Chrome refuses to
 * script, a slow network, or a feature switched off all degrade to "nothing
 * captured" — suspension never waits on this and never fails because of it.
 */

/** Candidates per page: a gallery can hold hundreds, and each one costs a fetch. */
const MAX_CANDIDATES = 60;

/**
 * Candidates read from the page before selection. Reading more than the fetch cap
 * is what lets the biggest pictures win; a page returns DOM order, not importance.
 */
const MAX_COLLECTED = 120;

/** Fetch concurrency: finishes a normal page quickly, stays polite on a CDN. */
const MAX_PARALLEL = 4;

interface ImageCandidate {
  src: string;
  pixels: number;
}

/**
 * Runs inside the page. `executeScript` serialises the source, so this closes
 * over nothing: the limit arrives as an argument.
 */
function collectCandidates(limit: number): ImageCandidate[] {
  const out: ImageCandidate[] = [];
  const push = (raw: string | null | undefined, pixels: number): void => {
    if (typeof raw !== 'string' || raw.length === 0) return;
    if (out.length >= limit) return;
    out.push({ src: raw, pixels });
  };

  for (const image of Array.from(document.images)) {
    push(image.currentSrc !== '' ? image.currentSrc : image.src, image.naturalWidth * image.naturalHeight);
  }

  const pattern = /^url\(\s*["']?([^"')]+)["']?\s*\)/;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
    if (out.length >= limit) break;
    const computed = getComputedStyle(element).backgroundImage;
    if (computed === 'none' || computed === '') continue;
    const match = pattern.exec(computed);
    if (match === null) continue;
    const raw = match[1];
    if (raw === undefined) continue;
    const box = element.getBoundingClientRect();
    push(raw, Math.round(box.width) * Math.round(box.height));
  }

  return out;
}

/** Resolves `work` or null when the tab's capture deadline runs out first. */
async function withDeadline<T>(
  work: Promise<T>,
  deadlineMs: number,
  startedAt: number,
): Promise<T | null> {
  const remaining = Math.max(1, deadlineMs - (Date.now() - startedAt));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), remaining);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Both halves of the optional grant, or the whole feature stays inert. */
async function hasCaptureGrant(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

/** Longest edge of a grid preview. Presentation, so it is not a config knob. */
const PREVIEW_EDGE = 480;

/**
 * Small copy for the gallery grid. The grid paints 24 tiles, and decoding the
 * full picture for each one is the memory cost this avoids. A service worker has
 * no DOM, so the downscale runs on an OffscreenCanvas; any failure leaves the
 * record without a preview and the grid falls back to the original.
 */
async function makePreview(blob: Blob): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const box = fitWithin(bitmap.width, bitmap.height, PREVIEW_EDGE);
    if (box.width === 0 || box.height === 0) {
      bitmap.close();
      return null;
    }
    // Already this small: the original is its own preview.
    if (box.width === bitmap.width && box.height === bitmap.height) {
      bitmap.close();
      return null;
    }
    const canvas = new OffscreenCanvas(box.width, box.height);
    const context = canvas.getContext('2d');
    if (context === null) {
      bitmap.close();
      return null;
    }
    context.drawImage(bitmap, 0, 0, box.width, box.height);
    bitmap.close();
    return await canvas.convertToBlob({ type: 'image/webp', quality: 0.72 });
  } catch {
    return null;
  }
}

/** Fetches one candidate, or null when it is not worth keeping. */
async function fetchCandidate(
  key: string,
  host: string,
  pageUrl: string,
  config: ImageCacheConfig,
  startedAt: number,
  deadlineMs: number,
): Promise<CachedImage | null> {
  const remaining = deadlineMs - (Date.now() - startedAt);
  if (remaining <= 0) return null;
  try {
    const response = await fetch(key, {
      credentials: 'include',
      signal: AbortSignal.timeout(remaining),
    });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (exceedsByteCeiling(blob.size, config)) return null;
    const mime = blob.type;
    // A CDN answering with HTML for a missing image is not an image.
    if (!mime.startsWith('image/')) return null;
    const now = Date.now();
    const preview = await makePreview(blob);
    return {
      key,
      host,
      pageUrl,
      mime,
      size: blob.size,
      savedAt: now,
      lastUsed: now,
      blob,
      ...(preview === null ? {} : { preview }),
    };
  } catch {
    return null;
  }
}

/**
 * Captures the images a tab is showing. Returns how many records were written.
 * Bounded by `images.captureDeadlineMs`, so a gallery page cannot delay a sweep.
 */
export async function captureTabImages(tabId: number, pageUrl: string): Promise<number> {
  const config = await getConfig();
  if (!config.images.enabled) return 0;
  const host = hostOfUrl(pageUrl);
  if (host === null) return 0;
  if (!(await hasCaptureGrant())) return 0;

  const startedAt = Date.now();
  const deadlineMs = config.images.captureDeadlineMs;

  let candidates: ImageCandidate[] = [];
  try {
    const injections = await withDeadline(
      chrome.scripting.executeScript({
        target: { tabId },
        args: [MAX_COLLECTED],
        func: collectCandidates,
      }),
      deadlineMs,
      startedAt,
    );
    const result = injections?.[0]?.result;
    if (Array.isArray(result)) candidates = result;
  } catch {
    // Restricted scheme, tab gone, or no renderer: nothing to capture.
    return 0;
  }
  if (candidates.length === 0) return 0;

  // Resolve keys once, in reader-visible order, so the budget follows importance.
  const targets: string[] = [];
  const queued = new Set<string>();
  for (const candidate of selectCaptureCandidates(candidates, MAX_CANDIDATES)) {
    if (!isCacheableImageUrl(candidate.src, pageUrl, candidate.pixels, config.images)) continue;
    const key = normalizeImageKey(candidate.src, pageUrl);
    if (key === null || queued.has(key)) continue;
    queued.add(key);
    targets.push(key);
  }
  if (targets.length === 0) return 0;

  // Bytes already held cost no budget: a second discard of one page must spend its
  // seconds on what is new instead of re-downloading what it wrote last time.
  const held = new Set((await readImages(targets)).map((row) => row.key));
  const fresh = targets.filter((key) => !held.has(key));
  if (fresh.length === 0) return 0;

  let cursor = 0;
  let saved = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() - startedAt >= deadlineMs) return;
      const key = fresh[cursor];
      cursor += 1;
      if (key === undefined) return;
      const record = await fetchCandidate(key, host, pageUrl, config.images, startedAt, deadlineMs);
      if (record === null) continue;
      try {
        await putImage(record);
        saved += 1;
      } catch (error) {
        console.warn('[tabdorm] image cache write failed.', error);
      }
    }
  };

  await Promise.all(Array.from({ length: MAX_PARALLEL }, worker));
  return saved;
}
