import type { CloseFocusMode } from '@/types';

/**
 * Pure activation-history math for "focus restore on close".
 *
 * The worker remembers, per window, which tabs you activated and in what group
 * each one sat. When you close the active tab, Chromium activates the
 * neighbouring tab — which is usually another member of the same group. This
 * module decides which tab `close-focus-tabs.ts` should activate instead.
 *
 * No chrome.* and no runtime imports here: the selection rules stay unit-testable.
 */

/** One remembered activation: which tab, and the group it was in when we saw it. */
export interface MruEntry {
  tabId: number;
  groupId: number;
}

/** The newest activation the worker has seen for a window. */
export interface Activation {
  tabId: number;
  at: number;
}

/**
 * Did the removed tab hold the window's active slot?
 *
 * Chromium may dispatch the neighbour's activation before the removal, so the
 * newest activation cannot be trusted alone: a *fresh* activation of another tab
 * that sits one slot ahead of the closed tab in history is Chromium's own
 * replacement pick, not the tab the user closed from.
 */
export function isActiveClose(
  stack: readonly MruEntry[],
  closedTabId: number,
  latest: Activation | undefined,
  now: number,
  freshnessMs: number,
): boolean {
  if (latest !== undefined && latest.tabId === closedTabId) return true;
  if (stack[0]?.tabId === closedTabId) return true;
  if (latest === undefined) return false;
  if (now - latest.at > freshnessMs) return false;
  return stack[1]?.tabId === closedTabId;
}

/** Records `entry` as most recent, de-duplicates it, and truncates to `depth`. */
export function pushMru(stack: readonly MruEntry[], entry: MruEntry, depth: number): MruEntry[] {
  const rest = stack.filter((item) => item.tabId !== entry.tabId);
  return [entry, ...rest].slice(0, Math.max(1, Math.trunc(depth)));
}

/** Drops a closed or otherwise dead tab from the stack. */
export function dropMru(stack: readonly MruEntry[], tabId: number): MruEntry[] {
  return stack.filter((item) => item.tabId !== tabId);
}

/** Re-stamps the remembered group of one tab after it moved groups. */
export function stampGroup(stack: readonly MruEntry[], tabId: number, groupId: number): MruEntry[] {
  return stack.map((item) => (item.tabId === tabId ? { tabId, groupId } : item));
}

/**
 * Which tab should become active after `closedTabId` was closed?
 *
 * `candidates` is the per-window activation history, most recent first, already
 * stripped of the closed tab and of tabs that no longer exist. `closedGroupId`
 * is the group the closed tab was last seen in, or null when unknown.
 *
 * Returns null when Chromium's own choice should stand:
 * "browser" mode, an empty history, or "previous-other-group" with no surviving
 * tab outside the closed tab's group.
 */
export function pickRestoreTarget(
  candidates: readonly MruEntry[],
  closedGroupId: number | null,
  mode: CloseFocusMode,
): number | null {
  if (mode === 'browser') return null;
  const mostRecent = candidates[0];
  if (mostRecent === undefined) return null;
  if (mode === 'previous-tab' || closedGroupId === null) return mostRecent.tabId;
  const outsideGroup = candidates.find((item) => item.groupId !== closedGroupId);
  return outsideGroup === undefined ? null : outsideGroup.tabId;
}
