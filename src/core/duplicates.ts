/**
 * Deterministic duplicate-tab detection and closing.
 *
 * Pure kernel: normalization and grouping have zero chrome.* dependencies;
 * only closeDuplicateTabs touches the extension API.
 */

export interface DuplicateTabEntry {
  tabId: number;
  title: string;
  url: string;
  pinned: boolean;
  active: boolean;
  discarded: boolean;
}

export interface DuplicateGroup {
  /** Normalized URL every entry in the group shares. */
  key: string;
  /** Short human label derived from the normalized URL. */
  label: string;
  /** Suggested survivor: the active tab if present, otherwise the oldest. */
  keepTabId: number;
  /** Keep candidate first, remaining entries ascending by tabId. */
  entries: DuplicateTabEntry[];
}

/** Fixed, closed tracking-param list — detection stays deterministic across releases. */
const TRACKING_PARAM_KEYS: readonly string[] = ['fbclid', 'gclid', 'dclid', 'msclkid', 'twclid', 'mc_eid', 'igshid', 'si'];

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAM_KEYS.includes(lower);
}

/**
 * Comparison key for two tabs "being the same page": lowercase host (www
 * prefix ignored), trailing path slash dropped, hash removed, tracking params
 * stripped, remaining query params sorted. Distinct paths/queries stay
 * distinct — facebook.com/feed is never a duplicate of facebook.com/profile.
 */
export function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = parsed.host.toLowerCase().replace(/^www\./, '');
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  const kept = [...parsed.searchParams.entries()].filter(([key]) => !isTrackingParam(key));
  kept.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const search = new URLSearchParams(kept).toString();
  return parsed.protocol + '//' + host + path + (search === '' ? '' : '?' + search);
}

function displayLabel(key: string): string {
  const withoutScheme = key.replace(/^https?:\/\//, '');
  const cutoff = withoutScheme.indexOf('?');
  return cutoff === -1 ? withoutScheme : withoutScheme.slice(0, cutoff);
}

export function findDuplicateGroups(rows: readonly DuplicateTabEntry[]): DuplicateGroup[] {
  const byKey = new Map<string, DuplicateTabEntry[]>();
  for (const row of rows) {
    if (row.url === '') continue;
    const key = normalizeUrl(row.url);
    const bucket = byKey.get(key);
    if (bucket === undefined) byKey.set(key, [row]);
    else bucket.push(row);
  }
  const groups: DuplicateGroup[] = [];
  for (const [key, bucket] of byKey) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.tabId - b.tabId);
    const keep = sorted.find((entry) => entry.active) ?? sorted[0];
    if (keep === undefined) continue;
    const entries = [keep, ...sorted.filter((entry) => entry !== keep)];
    groups.push({ key, label: displayLabel(key), keepTabId: keep.tabId, entries });
  }
  return groups;
}
