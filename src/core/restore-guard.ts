/**
 * Native Restore Guard.
 *
 * Chrome rebuilds a tab strip from persisted state on two occasions, and starts
 * loading every tab each time: extension-driven discard state survives neither
 * trip.
 *  - A browser start: "continue where you left off", a crash recovery, or a
 *    session restored after the process was killed.
 *  - A Ctrl+Shift+T reopen of a closed window.
 *
 * On a browser start the restored windows already exist before this service
 * worker registers its listeners, so `windows.onCreated` never fires for them —
 * `runtime.onStartup` is the trigger. For a reopened window the event is real.
 * Both paths match the live strip positionally against stored snapshots and
 * re-discard the background tabs that were asleep, so a restore returns to the
 * dormancy state it left in. A killed browser writes no `closed_window` row at
 * all (`windows.onRemoved` never fires), which makes the periodic
 * `auto_snapshot` the record of its last strip; both types are candidates.
 *
 * Windows created by TabDorm's own paced restoration are exempt via the
 * self-restored registry in `restoration.ts` (their tabs already follow
 * `restoreAsDiscarded`).
 *
 * The matching rules live in `restore-match.ts`: chrome-free, Node-testable.
 * This module reads the live strip and executes the discards.
 */

import type { StoredTab, TabDormConfig } from '@/types';
import { matchesUrlPattern } from './auto-route';
import { updateAsleepBadge } from './badge';
import { getConfig } from './config-store';
import { getRecentSessionsOfType } from './db';
import { discardTabSafe, scheduleDiscardOnCommit } from './discard';
import {
  findBestSnapshotWindow,
  GUARD_COUNT_TOLERANCE,
  planRediscards,
  type GuardMatchOptions,
  type GuardTab,
} from './restore-match';
import { isSelfRestoredWindow } from './restoration';
import { isSavableWindow } from './sanitize';

/** Grace period while Chrome streams the restored tab strip into the window. */
const RESTORE_GUARD_SETTLE_MS = 2_000;
/** Newest-first snapshots of each type tried before giving up on a match. */
const RESTORE_GUARD_CANDIDATES = 3;
/** Startup passes over the strip: Chrome streams restored tabs in over time. */
const STARTUP_GUARD_PASSES = 3;
/** Per-run marker. `chrome.storage.session` is wiped when the browser restarts. */
const STARTUP_GUARD_DONE_KEY = 'tabdorm:startupRestoreGuardDone';

/**
 * Registers both triggers. Call synchronously at SW startup: `onStartup` is
 * lost if the listener is added after an await.
 */
export function initRestoreGuard(): void {
  chrome.windows.onCreated.addListener((win) => {
    void guardRestoredWindow(win);
  });
  chrome.runtime.onStartup.addListener(() => {
    void guardBrowserStart();
  });
}

/**
 * Browser-start path. Runs up to `STARTUP_GUARD_PASSES` passes so a strip that
 * is still streaming in gets matched once its tabs arrive; a pass that plans
 * nothing ends the loop, which is also the fixed point after every discard.
 */
async function guardBrowserStart(): Promise<void> {
  try {
    const config = await getConfig();
    if (!config.restoration.nativeRestoreGuard) return;
    if (!(await claimStartupGuard())) return;
    for (let pass = 0; pass < STARTUP_GUARD_PASSES; pass++) {
      await sleep(RESTORE_GUARD_SETTLE_MS);
      const { acted } = await reDiscardEveryWindow(config);
      if (acted === 0) return;
    }
  } catch (error) {
    console.warn('[tabdorm] startup restore guard failed.', error);
  }
}

/**
 * One guard pass per browser run. A later service-worker wake inside the same
 * run finds the marker and does nothing: the strip it would re-check is the one
 * this run already handled.
 */
async function claimStartupGuard(): Promise<boolean> {
  try {
    const stored = await chrome.storage.session.get(STARTUP_GUARD_DONE_KEY);
    if (stored[STARTUP_GUARD_DONE_KEY] === true) return false;
    await chrome.storage.session.set({ [STARTUP_GUARD_DONE_KEY]: true });
    return true;
  } catch {
    // A storage failure must never disable the guard: `onStartup` fires once per
    // browser run anyway, and every discard below is idempotent.
    return true;
  }
}

interface WindowPass {
  /** Windows that matched a stored strip. */
  matched: number;
  /** Tabs put back to sleep, or scheduled for their document commit. */
  acted: number;
}

/** Re-discards every restored window in one pass over the live browser. */
async function reDiscardEveryWindow(config: TabDormConfig): Promise<WindowPass> {
  const windows = await chrome.windows.getAll({ populate: true }).catch(() => [] as chrome.windows.Window[]);
  // No age cutoff at startup: the browser may have been closed overnight, and
  // retention already bounds what is stored. The positional match is the gate.
  const candidates = await snapshotCandidates(0);
  let matched = 0;
  let acted = 0;
  for (const win of windows) {
    if (!isSavableWindow(win)) continue;
    if (win.id === undefined || isSelfRestoredWindow(win.id)) continue;
    if (win.tabs === undefined) continue;
    const liveTabs = guardTabsOf(win.tabs);
    const snapshotTabs = findBestSnapshotWindow(liveTabs, candidates, matchOptions(config));
    if (snapshotTabs === undefined) continue;
    matched += 1;
    acted += await reDiscardAsleepTabs(snapshotTabs, liveTabs, config);
  }
  if (acted > 0) {
    console.info(`[tabdorm] startup restore guard: ${String(matched)} window(s), ${String(acted)} tab(s) back to sleep.`);
    await updateAsleepBadge();
  }
  return { matched, acted };
}

/** Ctrl+Shift+T path: one freshly created window, matched against recent closes. */
async function guardRestoredWindow(win: chrome.windows.Window): Promise<void> {
  const config = await getConfig();
  if (!config.restoration.nativeRestoreGuard) return;
  if (!isSavableWindow(win)) return;
  if (win.id === undefined || isSelfRestoredWindow(win.id)) return;
  await sleep(RESTORE_GUARD_SETTLE_MS);
  const liveTabs = await liveTabsOfWindow(win.id);
  const cutoff = Date.now() - config.restoration.nativeRestoreGuardWindowMinutes * 60_000;
  const snapshotTabs = findBestSnapshotWindow(liveTabs, await snapshotCandidates(cutoff), matchOptions(config));
  if (snapshotTabs === undefined) return;
  const rediscarded = await reDiscardAsleepTabs(snapshotTabs, liveTabs, config);
  if (rediscarded > 0) {
    console.info(`[tabdorm] native restore guard: ${String(rediscarded)} tab(s) re-discarded after window restore.`);
    await updateAsleepBadge();
  }
}

function matchOptions(config: TabDormConfig): GuardMatchOptions {
  return {
    minTabs: config.restoration.nativeRestoreGuardMinTabs,
    countTolerance: GUARD_COUNT_TOLERANCE,
    matchPct: config.restoration.nativeRestoreGuardMatchPct,
  };
}

/**
 * Stored strips eligible for matching, newest first. Only the newest few rows of
 * each type are read, so a long history never loads into the worker.
 */
async function snapshotCandidates(cutoff: number): Promise<StoredTab[][]> {
  const [closed, auto] = await Promise.all([
    getRecentSessionsOfType('closed_window', RESTORE_GUARD_CANDIDATES).catch(() => []),
    getRecentSessionsOfType('auto_snapshot', RESTORE_GUARD_CANDIDATES).catch(() => []),
  ]);
  const sessions = [...closed, ...auto]
    .filter((session) => session.timestamp >= cutoff)
    .sort((a, b) => b.timestamp - a.timestamp);
  return sessions.flatMap((session) => session.windows.map((stored) => stored.tabs));
}

async function liveTabsOfWindow(windowId: number): Promise<GuardTab[]> {
  const tabs = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
  return guardTabsOf(tabs);
}

/** The fields matching needs, in strip order. */
function guardTabsOf(tabs: readonly chrome.tabs.Tab[]): GuardTab[] {
  return [...tabs]
    .sort((a, b) => a.index - b.index)
    .map((tab) => ({
      id: tab.id ?? -1,
      url: tab.url || tab.pendingUrl || 'about:blank',
      active: tab.active === true,
      pinned: tab.pinned === true,
      discarded: tab.discarded === true,
      status: tab.status ?? 'complete',
    }));
}

/**
 * Puts the snapshot's sleeping tabs back to sleep. A tab still mid-load cannot
 * be discarded yet (Chromium race), so it falls through to the Discard Race
 * Guard and is discarded once its document commits.
 */
async function reDiscardAsleepTabs(
  snapshotTabs: readonly StoredTab[],
  liveTabs: readonly GuardTab[],
  config: TabDormConfig,
): Promise<number> {
  const whitelist = config.suspension.exemptions.urlPatterns;
  const delay = config.restoration.delayBetweenTabsMs;
  const targets = planRediscards(snapshotTabs, liveTabs, {
    pinnedExempt: config.suspension.exemptions.pinnedTabs,
    isProtected: (url) => matchesUrlPattern(url, whitelist),
  });
  let acted = 0;
  for (const target of targets) {
    acted += 1;
    if (target.deferred) {
      scheduleDiscardOnCommit(target.tabId);
    } else {
      const outcome = await discardTabSafe(target.tabId);
      // A tab that lost the race still gets its turn at the document commit.
      if (outcome === 'skipped') scheduleDiscardOnCommit(target.tabId);
    }
    if (delay > 0) await sleep(delay);
  }
  return acted;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
