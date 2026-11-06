/**
 * Pinned image cache: the bytes a suspended tab was showing, kept locally so a
 * wake can paint them without the network.
 *
 * Records are keyed by the image's normalized absolute URL, never by tab id —
 * tab ids are reused across browser runs and a record must outlive a restart
 * for its whole TTL.
 */
export interface CachedImage {
  /** Normalized absolute URL, without the fragment. Primary key. */
  key: string;
  /** Host of the page that supplied the image, for the scoped clear. */
  host: string;
  /** Full URL of the page that supplied it, for the readout. */
  pageUrl: string;
  /** Response content type, used to build the data URL. */
  mime: string;
  /** Byte length of `blob`, for budget accounting. */
  size: number;
  /** Epoch ms at capture time — the TTL base. */
  savedAt: number;
  /** Epoch ms when last served — the LRU base. */
  lastUsed: number;
  /** The image bytes. */
  blob: Blob;
  /**
   * Downscaled copy for the gallery grid, written at capture time. Absent on
   * records from before previews existed, and on images already small enough to
   * paint whole, so every reader falls back to `blob`.
   */
  preview?: Blob;
}

/**
 * Session band: the same bytes while their tab is still open. Keyed by tab
 * first, so closing a tab deletes one range and browser start deletes the
 * whole band. At suspend the row is promoted into `CachedImage`.
 */
export interface CachedSessionImage {
  /** `${tabId}:${imageKey}` — tab identity first. */
  key: string;
  /** Owning tab. Tab ids are reused across runs, which is why this band never
   *  outlives a browser session. */
  tabId: number;
  /** The offline key this row promotes to. */
  imageKey: string;
  host: string;
  pageUrl: string;
  mime: string;
  size: number;
  savedAt: number;
  lastUsed: number;
  blob: Blob;
  preview?: Blob;
}

/** One gallery row, with the band it came from so the grid can tag it. */
export type GalleryImage = CachedImage & { origin: 'session' | 'offline' };

/** One host's share of the cache, as the Options readout shows it. */
export interface ImageHostStat {
  host: string;
  count: number;
  bytes: number;
  newestSavedAt: number;
}

/** Whole-store totals. */
export interface ImageCacheTotals {
  count: number;
  bytes: number;
}

/** Result of one clear action, reported to the surface that asked. */
export interface ImageClearResult {
  removed: number;
  bytes: number;
}
