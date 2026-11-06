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

/**
 * Chrome keeps the strip's scroll position across a group move, so the tab you are
 * working in can slide out of the visible strip the moment its group is reordered.
 * Highlighting the single active tab changes no selection but is the only API that
 * scrolls the strip to it. It fires `tabs.onHighlighted`, which nothing here
 * listens to, so this cannot re-enter the activation pass.
 */
async function revealActiveTab(tabId: number, windowId: number): Promise<void> {
  try {
    const fresh = await chrome.tabs.get(tabId);
    await chrome.tabs.highlight({ windowId, tabs: [fresh.index] });
  } catch {
    // A closed tab or a rejected index is not worth failing the reorder over.
  }
}
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
  } catch {
    return false;
  }
  // Read after the move: the index is stale the moment Chromium reorders the strip.
  await revealActiveTab(tabId, windowId);
  return true;
}
