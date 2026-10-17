import type { TabStat } from './stale';

/**
 * Persistent per-tab visit records for the stale-tab view.
 *
 * The suspension engine's activity clock lives in `chrome.storage.session` and is
 * wiped on browser restart, so age must be remembered somewhere durable:
 * `chrome.storage.local` holds `{ [tabId]: { firstSeen, lastActive } }`.
 *
 * Tab ids are reused across browser runs, so `pruneTabStats()` drops every record
 * whose tab no longer exists at worker bootstrap.
 */

const STATS_KEY = 'tabdorm:tabStats';

export type TabStats = Record<string, TabStat>;

/** Serialized read-modify-write chain — bursty tab events have no transactions. */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Runtime validation: stored data is untrusted, malformed records are dropped. */
export function parseTabStats(raw: unknown): TabStats {
  if (typeof raw !== 'object' || raw === null) return {};
  const stats: TabStats = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const entry = value as Record<string, unknown>;
    const firstSeen = entry['firstSeen'];
    const lastActive = entry['lastActive'];
    if (!isFiniteNumber(firstSeen) || !isFiniteNumber(lastActive)) continue;
    stats[key] = { firstSeen, lastActive };
  }
  return stats;
}

export async function getTabStats(): Promise<TabStats> {
  const stored = await chrome.storage.local.get(STATS_KEY);
  return parseTabStats(stored[STATS_KEY]);
}

/**
 * Creates or refreshes one tab's record. `visited` stamps "now" as the last visit;
 * without it only `firstSeen` is created (a tab opened in the background and never
 * looked at keeps lastActive = 0, i.e. an unknown age).
 */
export function rememberTab(tabId: number, visited: boolean): Promise<void> {
  return serialize(async () => {
    const stats = await getTabStats();
    const existing = stats[String(tabId)];
    const now = Date.now();
    stats[String(tabId)] = {
      firstSeen: existing?.firstSeen ?? now,
      lastActive: visited ? now : (existing?.lastActive ?? 0),
    };
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  });
}

export function forgetTab(tabId: number): Promise<void> {
  return serialize(async () => {
    const stats = await getTabStats();
    if (stats[String(tabId)] === undefined) return;
    delete stats[String(tabId)];
    await chrome.storage.local.set({ [STATS_KEY]: stats });
  });
}

/** Drops records whose tab no longer exists. Returns how many were removed. */
export function pruneTabStats(): Promise<number> {
  return serialize(async () => {
    const stats = await getTabStats();
    const tabs = await chrome.tabs.query({});
    const live = new Set<string>();
    for (const tab of tabs) {
      if (tab.id !== undefined) live.add(String(tab.id));
    }
    const kept: TabStats = {};
    let dropped = 0;
    for (const [key, stat] of Object.entries(stats)) {
      if (live.has(key)) kept[key] = stat;
      else dropped += 1;
    }
    if (dropped > 0) await chrome.storage.local.set({ [STATS_KEY]: kept });
    return dropped;
  });
}

/**
 * Registers visit tracking. MUST run synchronously inside defineBackground() so a
 * tab created or activated during worker spin-up is still recorded.
 */
export function initTabStats(): void {
  chrome.tabs.onCreated.addListener((tab) => {
    if (tab.id === undefined) return;
    void rememberTab(tab.id, tab.active === true);
  });
  chrome.tabs.onActivated.addListener((info) => {
    void rememberTab(info.tabId, true);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || tab.active !== true) return;
    void rememberTab(tabId, true);
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetTab(tabId);
  });
}
