/**
 * Which tab takes focus before the tab in front of the reader is suspended.
 * Chromium refuses to discard the active tab, so an explicit "suspend this tab"
 * has to hand focus to a sibling first. Pure, so the choice stays testable.
 */

export interface FocusableTab {
  id?: number | undefined;
  index: number;
  discarded?: boolean | undefined;
  lastAccessed?: number | undefined;
}

/**
 * The most recently used sibling that still has a renderer.
 *
 * A discarded sibling is skipped on purpose: focusing it would force a reload,
 * which is the opposite of what the reader asked for. Null means there is
 * nowhere to move focus, so the caller must say so instead of doing nothing.
 * Ties break on index, then id, so the same window always yields the same tab.
 */
export function pickFocusCandidate<T extends FocusableTab>(
  tabs: readonly T[],
  activeTabId: number | undefined,
): T | null {
  let best: T | null = null;
  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === activeTabId) continue;
    if (tab.discarded === true) continue;
    if (best === null) {
      best = tab;
      continue;
    }
    const candidateRecent = tab.lastAccessed ?? 0;
    const bestRecent = best.lastAccessed ?? 0;
    if (candidateRecent > bestRecent) {
      best = tab;
      continue;
    }
    if (candidateRecent < bestRecent) continue;
    if (tab.index < best.index || (tab.index === best.index && tab.id < (best.id ?? tab.id))) best = tab;
  }
  return best;
}
