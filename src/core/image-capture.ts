import { getConfig } from './config-store';
import { exceedsByteCeiling, hostOfUrl, isCacheableImageUrl, normalizeImageKey } from './image-cache';
import { putImage } from './image-store';
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
    return { key, host, pageUrl, mime, size: blob.size, savedAt: now, lastUsed: now, blob };
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
        args: [MAX_CANDIDATES],
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

  const written = new Set<string>();
  let cursor = 0;
  let saved = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() - startedAt >= deadlineMs) return;
      const candidate = candidates[cursor];
      cursor += 1;
      if (candidate === undefined) return;
      const key = normalizeImageKey(candidate.src, pageUrl);
      if (key === null || written.has(key)) continue;
      if (!isCacheableImageUrl(candidate.src, pageUrl, candidate.pixels, config.images)) continue;
      const record = await fetchCandidate(key, host, pageUrl, config.images, startedAt, deadlineMs);
      if (record === null) continue;
      written.add(key);
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
