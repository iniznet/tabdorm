/**
 * Pure stale-tab logic: visit ages, stale flagging, ordering, and bulk-close
 * selection. No chrome.* and no runtime imports — the rules stay testable.
 */

/** One persisted per-tab visit record (see `tab-stats.ts`). */
export interface TabStat {
  firstSeen: number;
  /** Last time the tab was active, or reloaded while active. 0 = never observed. */
  lastActive: number;
}

/** A live tab joined with its visit record, ready for sorting and display. */
export interface StaleRow {
  tabId: number;
  windowId: number;
  title: string;
  url: string;
  groupTitle: string | null;
  pinned: boolean;
  active: boolean;
  audible: boolean;
  discarded: boolean;
  firstSeen: number;
  /** 0 when the tab has no visit record yet — its age is unknown. */
  lastActive: number;
}

const DAY_MS = 86_400_000;

/** Whole days since the last visit, or null when the tab was never observed. */
export function ageDays(lastActive: number, now: number): number | null {
  if (lastActive <= 0) return null;
  return Math.max(0, Math.floor((now - lastActive) / DAY_MS));
}

/** Short display label for an age. */
export function ageLabel(lastActive: number, now: number): string {
  const age = ageDays(lastActive, now);
  if (age === null) return 'never seen';
  if (age === 0) return 'today';
  if (age === 1) return '1 day ago';
  return age + ' days ago';
}

/** A row is stale when its age is known and at least `thresholdDays`; 0 disables flagging. */
export function isStale(row: StaleRow, thresholdDays: number, now: number): boolean {
  if (thresholdDays <= 0) return false;
  const age = ageDays(row.lastActive, now);
  return age !== null && age >= thresholdDays;
}

/**
 * Unknown-age rows first — those are the tabs the tracker never saw you open —
 * then oldest visit first, then the longest-open tab.
 */
export function sortStale(rows: readonly StaleRow[]): StaleRow[] {
  return [...rows].sort((a, b) => {
    const aKnown = a.lastActive > 0;
    const bKnown = b.lastActive > 0;
    if (aKnown !== bKnown) return aKnown ? 1 : -1;
    if (a.lastActive !== b.lastActive) return a.lastActive - b.lastActive;
    if (a.firstSeen !== b.firstSeen) return a.firstSeen - b.firstSeen;
    return a.tabId - b.tabId;
  });
}

/**
 * The rows a bulk close may touch: stale, and neither the active tab, a pinned
 * tab, nor a tab that is currently playing audio. Unknown-age rows are kept,
 * because their staleness cannot be proven.
 */
export function selectClosable(rows: readonly StaleRow[], thresholdDays: number, now: number): StaleRow[] {
  return rows.filter(
    (row) => !row.active && !row.pinned && !row.audible && isStale(row, thresholdDays, now),
  );
}
