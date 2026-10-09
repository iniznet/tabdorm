import { getDirtyFormTabs } from '@/core/form-guard';

export interface CloseDuplicateOutcome {
  closed: number[];
  skipped: { tabId: number; reason: 'gone' | 'active' | 'unsaved-form' }[];
}

/** Hard ceiling so a pathological request can never fan out unbounded. */
export const MAX_CLOSE_BATCH = 500;

/**
 * Closes the requested tabs with data-loss guard rails: the active tab of any
 * window and any tab holding unsaved form input are skipped, never closed.
 */
export async function closeDuplicateTabs(requested: readonly number[]): Promise<CloseDuplicateOutcome> {
  const [tabs, dirty] = await Promise.all([chrome.tabs.query({}), getDirtyFormTabs()]);
  const known = new Map<number, chrome.tabs.Tab>();
  for (const tab of tabs) {
    if (tab.id !== undefined) known.set(tab.id, tab);
  }
  const closed: number[] = [];
  const skipped: CloseDuplicateOutcome['skipped'] = [];
  for (const tabId of requested) {
    const tab = known.get(tabId);
    if (tab === undefined) {
      skipped.push({ tabId, reason: 'gone' });
    } else if (tab.active) {
      skipped.push({ tabId, reason: 'active' });
    } else if (dirty.has(tabId)) {
      skipped.push({ tabId, reason: 'unsaved-form' });
    } else {
      closed.push(tabId);
    }
  }
  if (closed.length > 0) await chrome.tabs.remove(closed);
  return { closed, skipped };
}
