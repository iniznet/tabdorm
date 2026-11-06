import { groupIdsInStripOrder, orderTargetIndex } from './group-order';
import type { GroupOrderMode } from '@/types';

/**
 * Group ordering on activate.
 *
 * Chrome's strip keeps groups in tab order, and a long strip buries the group you
 * are working in. Every activation re-reads the window, and the activated group
 * moves to the requested end of the strip unless it already sits there.
 *
 * Single writer for `chrome.tabGroups.move`: no other module reorders groups.
 */
export async function applyActiveGroupOrder(
  windowId: number,
  tabId: number,
  mode: GroupOrderMode,
): Promise<boolean> {
  if (mode === 'off') return false;
  const tabs = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
  const active = tabs.find((tab) => tab.id === tabId);
  if (active === undefined || active.groupId < 0) return false;
  const order = groupIdsInStripOrder(tabs.map((tab) => ({ groupId: tab.groupId, index: tab.index })));
  const target = orderTargetIndex(mode, order, active.groupId);
  if (target === null) return false;
  try {
    await chrome.tabGroups.move(active.groupId, { index: target, windowId });
    return true;
  } catch {
    return false;
  }
}
