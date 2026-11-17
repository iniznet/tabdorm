import { planActiveGroupOrder } from './group-order';
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
 * One reorder chain per window.
 *
 * Closing a tab fires two activations in the same window — Chromium's neighbour and
 * the focus restore — so two passes would otherwise read the strip at the same
 * moment, each send a different group to the end, and leave the final order to
 * whichever `tabGroups.move` resolved last. A queued pass re-reads the strip when
 * it starts, so its plan always sees live state.
 */
const chains = new Map<number, Promise<unknown>>();

function perWindow<T>(windowId: number, task: () => Promise<T>): Promise<T> {
  const run = (chains.get(windowId) ?? Promise.resolve()).then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  chains.set(windowId, tail);
  void tail.then(() => {
    // Drop the entry once it is the settled tail: a long session must not grow this.
    if (chains.get(windowId) === tail) chains.delete(windowId);
  });
  return run;
}

/**
 * Chrome keeps the strip's scroll position across a group move, so the tab you are
 * working in can slide out of the visible strip the moment its group is reordered.
 * Highlighting that tab is the only API that asks the strip to scroll to it.
 *
 * Chromium makes the first index of `tabs` the active tab, so this call fires
 * `tabs.onActivated` and not only `tabs.onHighlighted` (see
 * `planActiveGroupOrder` for why that ends a ping-pong). It may therefore only ever
 * point at the tab that already owns the slot; any other target is a focus steal.
 */
async function revealActiveTab(tabId: number, windowId: number): Promise<void> {
  try {
    const fresh = await chrome.tabs.get(tabId);
    if (fresh.active !== true) return;
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
  return perWindow(windowId, async () => {
    const tabs = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
    const plan = planActiveGroupOrder(mode, tabs, tabId);
    if (plan === null || plan.moveTo === null) return false;
    try {
      await chrome.tabGroups.move(plan.groupId, { index: plan.moveTo, windowId });
    } catch {
      return false;
    }
    // Read after the move: the index is stale the moment Chromium reorders the strip.
    await revealActiveTab(tabId, windowId);
    return true;
  });
}
