/**
 * Pure stale-tab logic: visit ages, stale flagging, ordering, and bulk-close
 * selection. No chrome.* and no runtime imports — the rules stay testable.
 *
 * Ages are handled in milliseconds end to end; the UI decides whether to show
 * minutes, hours, days, or weeks. A 12-hour staleness threshold is a real case.
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
  /** 0 when neither the tracker nor Chrome can date the tab. */
  lastActive: number;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const WEEK_MS = 604_800_000;

/** Milliseconds since the last visit, or null when the age is unknown. */
export function ageMs(lastActive: number, now: number): number | null {
  if (lastActive <= 0) return null;
  return Math.max(0, now - lastActive);
}

/**
 * Short, human label at the coarsest unit that still informs: minutes under an
 * hour, hours under a day, days under two weeks, weeks beyond that.
 */
export function ageLabel(lastActive: number, now: number): string {
  const age = ageMs(lastActive, now);
  if (age === null) return 'age unknown';
  if (age < MINUTE_MS) return 'just now';
  if (age < HOUR_MS) return `${String(Math.floor(age / MINUTE_MS))} min`;
  if (age < DAY_MS) return `${String(Math.floor(age / HOUR_MS))} h`;
  if (age < 2 * WEEK_MS) return `${String(Math.floor(age / DAY_MS))} d`;
  return `${String(Math.floor(age / WEEK_MS))} w`;
}

/** Same units as `ageLabel`, for threshold copy such as "12 h+". */
export function durationLabel(ms: number): string {
  if (ms >= 2 * WEEK_MS) return `${String(Math.round(ms / WEEK_MS))} w`;
  if (ms >= DAY_MS) return `${String(Math.round(ms / DAY_MS))} d`;
  if (ms >= HOUR_MS) return `${String(Math.round(ms / HOUR_MS))} h`;
  return `${String(Math.max(1, Math.round(ms / MINUTE_MS)))} min`;
}

/** A row is stale when its age is known and at least `thresholdMs`; 0 disables flagging. */
export function isStale(row: StaleRow, thresholdMs: number, now: number): boolean {
  if (thresholdMs <= 0) return false;
  const age = ageMs(row.lastActive, now);
  return age !== null && age >= thresholdMs;
}

/**
 * Unknown-age rows first — those are tabs no clock can date — then oldest visit
 * first, then the longest-open tab.
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
export function selectClosable(rows: readonly StaleRow[], thresholdMs: number, now: number): StaleRow[] {
  return rows.filter(
    (row) => !row.active && !row.pinned && !row.audible && isStale(row, thresholdMs, now),
  );
}
