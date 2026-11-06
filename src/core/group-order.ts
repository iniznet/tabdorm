/**
 * Pure group-ordering rules. No imports on purpose: the service worker and the Node
 * test runner both load this file, so it must resolve without the `@/` alias.
 */

/** Chromium's "not in a group" id. */
const GROUP_NONE = -1;

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
