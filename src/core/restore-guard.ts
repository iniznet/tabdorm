/**
 * Native Restore Guard.
 *
 * Chrome's Ctrl+Shift+T (reopen closed window) recreates every tab of the
 * closed window and starts loading ALL of them — extension-driven discard
 * state does not survive the round trip. On a few hundred tabs that is a
 * renderer-process and memory spike.
 *
 * When a new window appears, this guard matches its tab strip positionally
 * against the newest `closed_window` snapshots. On a match it re-discards the
 * background tabs that were asleep when the window closed, so a native restore
 * returns to the dormancy state it left in. Windows created by TabDorm's own
 * paced restoration are exempt via the self-restored registry in
 * `restoration.ts` (their tabs already follow `restoreAsDiscarded`).
 *
 * The matching helpers are chrome-free and testable in isolation.
 */

import type { StoredTab, TabDormConfig } from '@/types';
import { matchesUrlPattern } from './auto-route';
import { updateAsleepBadge } from './badge';
import { getConfig } from './config-store';
import { getRecentSessionsOfType } from './db';
import { discardTabSafe, scheduleDiscardOnCommit } from './discard';
import { normalizeUrl } from './duplicates';
import { isSelfRestoredWindow } from './restoration';
import { isSavableWindow, stripSensitiveParams } from './sanitize';

/** Grace period while Chrome streams the restored tab strip into the window. */
const RESTORE_GUARD_SETTLE_MS = 2_000;
/** Newest-first `closed_window` snapshots tried before giving up on a match. */
const RESTORE_GUARD_CANDIDATES = 3;
/** Live tab count may drift from the snapshot by this fraction and still match. */
const RESTORE_GUARD_COUNT_TOLERANCE = 0.1;

/** A live tab as the guard sees it: id plus the fields matching needs. */
export interface GuardTab {
  id: number;
  url: string;
  active: boolean;
  pinned: boolean;
  status: string;
}

/** Comparison key for "same page at the same position". */
function comparisonKey(url: string): string {
  return normalizeUrl(stripSensitiveParams(url));
}

/**
 * Fraction of snapshot tabs whose positionally-aligned live counterpart has
 * the same comparison key. `about:blank` placeholders count as neutral
 * (neither a match nor a mismatch); tabs beyond the overlap are ignored here —
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
    const snapKey = comparisonKey(snap.url);
    const liveKey = comparisonKey(live.url);
    if (snapKey === 'about:blank' || liveKey === 'about:blank') continue;
    comparable += 1;
    if (snapKey === liveKey) matched += 1;
  }
  if (comparable === 0) return 0;
  return matched / comparable;
}

/** Registers the guard's window listener. Call synchronously at SW startup. */
export function initRestoreGuard(): void {
  chrome.windows.onCreated.addListener((win) => {
    void guardRestoredWindow(win);
  });
}

async function guardRestoredWindow(win: chrome.windows.Window): Promise<void> {
  const config = await getConfig();
  if (!config.restoration.nativeRestoreGuard) return;
  if (!isSavableWindow(win)) return;
  if (win.id === undefined || isSelfRestoredWindow(win.id)) return;
  await sleep(RESTORE_GUARD_SETTLE_MS);
  const liveTabs = (await chrome.tabs.query({ windowId: win.id }).catch(() => [] as chrome.tabs.Tab[]))
    .sort((a, b) => a.index - b.index)
    .map((tab): GuardTab => ({
      id: tab.id ?? -1,
      url: tab.url || tab.pendingUrl || 'about:blank',
      active: tab.active === true,
      pinned: tab.pinned === true,
      status: tab.status ?? 'complete',
    }));
  if (liveTabs.length < config.restoration.nativeRestoreGuardMinTabs) return;
  const cutoff = Date.now() - config.restoration.nativeRestoreGuardWindowMinutes * 60_000;
  const sessions = await getRecentSessionsOfType('closed_window', RESTORE_GUARD_CANDIDATES).catch(() => []);
  let best: { tabs: StoredTab[]; ratio: number } | undefined;
  for (const session of sessions) {
    if (session.timestamp < cutoff) break; // newest-first: older snapshots only fall further behind
    for (const stored of session.windows) {
      if (stored.tabs.length < config.restoration.nativeRestoreGuardMinTabs) continue;
      if (Math.abs(liveTabs.length - stored.tabs.length) > stored.tabs.length * RESTORE_GUARD_COUNT_TOLERANCE) continue;
      const ratio = restoreMatchRatio(stored.tabs, liveTabs);
      if (best === undefined || ratio > best.ratio) best = { tabs: stored.tabs, ratio };
    }
  }
  if (best === undefined || best.ratio * 100 < config.restoration.nativeRestoreGuardMatchPct) return;
  const rediscarded = await reDiscardAsleepTabs(best.tabs, liveTabs, config);
  if (rediscarded > 0) {
    console.info(`[tabdorm] native restore guard: ${String(rediscarded)} tab(s) re-discarded after window restore.`);
    await updateAsleepBadge();
  }
}

/**
 * Re-discards the background tabs that were asleep at close time. Tabs still
 * mid-load cannot be discarded yet (Chromium race), so they fall through to
 * the Discard Race Guard and are discarded once their document commits.
 */
async function reDiscardAsleepTabs(
  snapshotTabs: readonly StoredTab[],
  liveTabs: readonly GuardTab[],
  config: TabDormConfig,
): Promise<number> {
  const whitelist = config.suspension.exemptions.urlPatterns;
  const delay = config.restoration.delayBetweenTabsMs;
  let rediscarded = 0;
  const len = Math.min(snapshotTabs.length, liveTabs.length);
  for (let i = 0; i < len; i++) {
    const snap = snapshotTabs[i];
    const live = liveTabs[i];
    if (snap === undefined || live === undefined || live.id === -1) continue;
    if (!snap.isDiscarded) continue; // awake at close — reloading it is correct
    if (live.active) continue; // never put the focused tab to sleep
    if (live.pinned && config.suspension.exemptions.pinnedTabs) continue;
    if (matchesUrlPattern(live.url, whitelist)) continue;
    const outcome = await discardTabSafe(live.id);
    if (outcome === 'skipped' && live.status === 'loading') scheduleDiscardOnCommit(live.id);
    else if (outcome === 'discarded') rediscarded += 1;
    if (delay > 0) await sleep(delay);
  }
  return rediscarded;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
