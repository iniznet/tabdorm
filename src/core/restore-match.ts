/**
 * Native restore matching.
 *
 * Chrome rebuilds a tab strip from persisted state on two occasions: a browser
 * start ("continue where you left off") and a Ctrl+Shift+T reopen of a closed
 * window. Extension discard flags survive neither, so every tab starts loading.
 * These rules decide whether a live strip is the strip a snapshot recorded and
 * which of its tabs the guard must put back to sleep.
 *
 * Pure: no chrome.* calls, no storage. `restore-guard.ts` reads the live strip
 * and executes the discards.
 */

import type { StoredTab } from '@/types';
// Explicit .ts specifiers: the Node test runner loads this module directly, so the
// chain below it must resolve without the `@/` alias. Both leaves import nothing.
import { normalizeUrl } from './duplicates.ts';
import { stripSensitiveParams } from './sanitize.ts';

/** Live count may drift from the snapshot by this fraction and still match. */
export const GUARD_COUNT_TOLERANCE = 0.1;

/** A live tab as the guard sees it: id plus the fields matching needs. */
export interface GuardTab {
  id: number;
  url: string;
  active: boolean;
  pinned: boolean;
  discarded: boolean;
  status: string;
}

export interface GuardMatchOptions {
  /** A strip and a snapshot below this tab count never match. */
  minTabs: number;
  /** Fractional drift allowed between the live and stored tab counts. */
  countTolerance: number;
  /** Percentage of positionally-aligned tabs that must agree. */
  matchPct: number;
}

export interface RediscardOptions {
  /** `suspension.exemptions.pinnedTabs`: pinned tabs are never put to sleep. */
  pinnedExempt: boolean;
  /** Suspension URL whitelist, injected so this module stays chrome-free. */
  isProtected: (url: string) => boolean;
}

/** One tab the guard puts back to sleep; `deferred` means "at document commit". */
export interface RediscardTarget {
  tabId: number;
  deferred: boolean;
}

/** Comparison key for "same page at the same position". */
function comparisonKey(url: string): string {
  return normalizeUrl(stripSensitiveParams(url));
}

/**
 * A tab Chrome has not resolved to a URL yet reads as `about:blank`, in a
 * snapshot and in a restored strip alike. Such an entry is evidence for neither
 * side, so it never votes. The raw url is tested on purpose: `normalizeUrl`
 * rebuilds its key as `protocol//host/path`, turning `about:blank` into
 * `about://blank`, so a sentinel compare against the key is dead code.
 */
function isBlank(url: string): boolean {
  return url === '' || url.startsWith('about:blank');
}

/**
 * Fraction of snapshot tabs whose positionally-aligned live counterpart has
 * the same comparison key. A blank entry (see `isBlank`) counts as neutral,
 * neither a match nor a mismatch; tabs beyond the overlap are ignored here —
 * the caller checks count tolerance separately.
 */
export function restoreMatchRatio(
  snapshotTabs: readonly StoredTab[],
  liveTabs: readonly GuardTab[],
): number {
  const len = Math.min(snapshotTabs.length, liveTabs.length);
  if (len === 0) return 0;
  let comparable = 0;
  let matched = 0;
  for (let i = 0; i < len; i++) {
    const snap = snapshotTabs[i];
    const live = liveTabs[i];
    if (snap === undefined || live === undefined) continue;
    if (isBlank(snap.url) || isBlank(live.url)) continue;
    const snapKey = comparisonKey(snap.url);
    const liveKey = comparisonKey(live.url);
    comparable += 1;
    if (snapKey === liveKey) matched += 1;
  }
  if (comparable === 0) return 0;
  return matched / comparable;
}

/**
 * The stored strip this live window rebuilds, or undefined when no candidate
 * clears the thresholds. Best ratio wins; a snapshot that cannot be the same
 * strip (too few tabs, count drift) is never compared at all.
 */
export function findBestSnapshotWindow(
  liveTabs: readonly GuardTab[],
  candidateWindows: readonly (readonly StoredTab[])[],
  options: GuardMatchOptions,
): StoredTab[] | undefined {
  if (liveTabs.length < options.minTabs) return undefined;
  let best: StoredTab[] | undefined;
  let bestRatio = 0;
  for (const stored of candidateWindows) {
    if (stored.length < options.minTabs) continue;
    if (Math.abs(liveTabs.length - stored.length) > stored.length * options.countTolerance) continue;
    const ratio = restoreMatchRatio(stored, liveTabs);
    if (ratio > bestRatio) {
      best = [...stored];
      bestRatio = ratio;
    }
  }
  if (best === undefined || bestRatio * 100 < options.matchPct) return undefined;
  return best;
}

/**
 * Tabs to put back to sleep, decided from the snapshot's own claim: a tab that
 * was awake when the snapshot was taken is meant to load, and one that was
 * asleep must not stay awake because the browser restarted.
 *
 * Skipped: tabs already asleep, the focused tab (Chromium refuses it anyway),
 * pinned tabs when the exemption is on, and whitelisted pages. A tab still
 * mid-load cannot be discarded yet, so it is deferred to its document commit.
 */
export function planRediscards(
  snapshotTabs: readonly StoredTab[],
  liveTabs: readonly GuardTab[],
  options: RediscardOptions,
): RediscardTarget[] {
  const targets: RediscardTarget[] = [];
  const len = Math.min(snapshotTabs.length, liveTabs.length);
  for (let i = 0; i < len; i++) {
    const snap = snapshotTabs[i];
    const live = liveTabs[i];
    if (snap === undefined || live === undefined) continue;
    if (!snap.isDiscarded) continue;
    if (live.id === -1 || live.discarded || live.active) continue;
    if (live.pinned && options.pinnedExempt) continue;
    if (options.isProtected(live.url)) continue;
    targets.push({ tabId: live.id, deferred: live.status === 'loading' });
  }
  return targets;
}
