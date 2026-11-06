/**
 * Pure collapse rules. No imports on purpose: the service worker and the Node test
 * runner both load this file, so it must resolve without the `@/` alias or chrome.
 */

/** Chromium's "not in a group" id. */
const GROUP_NONE = -1;

/** Pure: which group a switch should collapse, or null when none qualifies. */
export function pickCollapseTarget(prevGroupId: number, newGroupId: number): number | null {
  if (prevGroupId === GROUP_NONE) return null;
  if (newGroupId === prevGroupId) return null;
  return prevGroupId;
}

export interface IdleGroupCandidate {
  groupId: number;
  collapsed: boolean;
  /** Per-member last-activity timestamps (ms epoch). 0 means "never observed". */
  memberActivity: number[];
  hasActiveTabInFocusedWindow: boolean;
}

/**
 * Pure: uncollapsed groups idle past the threshold with no focused-window active
 * tab. 0 disables.
 *
 * A member with an unknown clock (0) blocks the group. Unknown age is not evidence
 * of idleness: a tab restored as discarded never fires `status === 'complete'`, so
 * treating 0 as infinitely old folds every such group in a single sweep.
 */
export function selectIdleGroups(candidates: IdleGroupCandidate[], thresholdMs: number, now: number): number[] {
  if (thresholdMs <= 0) return [];
  const cutoff = now - thresholdMs;
  return candidates
    .filter(
      (c) =>
        !c.collapsed &&
        !c.hasActiveTabInFocusedWindow &&
        c.memberActivity.length > 0 &&
        c.memberActivity.every((at) => at > 0) &&
        Math.max(...c.memberActivity) <= cutoff,
    )
    .map((c) => c.groupId);
}

export interface CollapseGuardInput {
  /** The group still exists in the browser. */
  exists: boolean;
  /** The group is already collapsed. */
  collapsed: boolean;
  /** Any member tab is the active tab of its window. */
  holdsActiveTab: boolean;
}

/**
 * Pure: may this collapse write run?
 *
 * Folding the group that holds the active tab makes Chromium activate a neighbour,
 * which fires another activation, so one stale decision cascades into every group
 * folding at once. The guard runs at write time, after every await.
 */
export function canCollapseGroup(input: CollapseGuardInput): boolean {
  if (!input.exists) return false;
  if (input.collapsed) return false;
  return !input.holdsActiveTab;
}
