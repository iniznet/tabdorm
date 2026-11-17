/**
 * Pure group-ordering rules. No imports on purpose: the service worker and the Node
 * test runner both load this file, so it must resolve without the `@/` alias.
 */

/** Chromium's "not in a group" id. */
const GROUP_NONE = -1;

/** The strip facts the ordering plan needs; `chrome.tabs.Tab` satisfies it. */
export interface StripTab {
  id?: number | undefined;
  groupId: number;
  index: number;
  active?: boolean | undefined;
}

/** The single write one activation pass may still perform. */
export interface GroupOrderPlan {
  groupId: number;
  /** Index for `chrome.tabGroups.move`, or null when the group already sits there. */
  moveTo: number | null;
}

/**
 * Pure: the `chrome.tabGroups.move` index for a group, or null when the group
 * already sits at the requested end (a redundant move rebuilds the strip and fires
 * more events than it is worth). `-1` means "end of the window" to Chrome.
 */
export function orderTargetIndex(
  mode: string,
  groupIdsInStripOrder: readonly number[],
  groupId: number,
): number | null {
  if (mode !== 'top' && mode !== 'bottom') return null;
  const position = groupIdsInStripOrder.indexOf(groupId);
  if (position < 0) return null;
  if (mode === 'bottom') return position === groupIdsInStripOrder.length - 1 ? null : -1;
  return position === 0 ? null : 0;
}

/**
 * Pure: what the activation pass for `tabId` may still write, or null when that
 * pass is stale and must write nothing.
 *
 * A pass awaits storage and config before it writes, so the reader may have moved
 * on by then: closing one tab fires two activations in the same window. A stale
 * write reorders a group the reader has left, and its strip reveal takes the
 * active slot back — which fires another activation and hands that pass its own
 * stale write. Null is the refusal, and it is why the strip settles.
 */
export function planActiveGroupOrder(
  mode: string,
  tabs: readonly StripTab[],
  tabId: number,
): GroupOrderPlan | null {
  if (mode !== 'top' && mode !== 'bottom') return null;
  const target = tabs.find((tab) => tab.id === tabId);
  if (target === undefined) return null;
  if (target.groupId < 0) return null;
  if (target.active !== true) return null;
  return {
    groupId: target.groupId,
    moveTo: orderTargetIndex(mode, groupIdsInStripOrder(tabs), target.groupId),
  };
}

/**
 * Pure: distinct group ids in strip order.
 *
 * `chrome.tabGroups` exposes no index on its TabGroup object, so the strip order is
 * derived from tab order: a group sits where its leftmost member sits.
 */
export function groupIdsInStripOrder(
  tabs: readonly { groupId: number; index: number }[],
  ungroupedId: number = GROUP_NONE,
): number[] {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const ids: number[] = [];
  const seen = new Set<number>();
  for (const tab of sorted) {
    if (tab.groupId === ungroupedId || tab.groupId < 0 || seen.has(tab.groupId)) continue;
    seen.add(tab.groupId);
    ids.push(tab.groupId);
  }
  return ids;
}
