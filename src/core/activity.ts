const ACTIVITY_KEY = 'tabdorm:activity';
const COOLDOWN_KEY = 'tabdorm:wakeCooldownUntil';

type ActivityMap = Record<string, number>;

async function readActivity(): Promise<ActivityMap> {
  const stored = await chrome.storage.session.get(ACTIVITY_KEY);
  const value = stored[ACTIVITY_KEY];
  return typeof value === 'object' && value !== null ? (value as ActivityMap) : {};
}

async function writeActivity(map: ActivityMap): Promise<void> {
  await chrome.storage.session.set({ [ACTIVITY_KEY]: map });
}

/** Records now as the last-activity timestamp for a tab. */
export async function touchActivity(tabId: number, at: number = Date.now()): Promise<void> {
  const map = await readActivity();
  map[String(tabId)] = at;
  await writeActivity(map);
}

export async function getLastActivity(tabId: number): Promise<number> {
  const map = await readActivity();
  const at = map[String(tabId)];
  return typeof at === 'number' ? at : 0;
}

/** Drops tracking for tabs that no longer exist. */
export async function forgetActivity(tabId: number): Promise<void> {
  const map = await readActivity();
  if (map[String(tabId)] === undefined) return;
  delete map[String(tabId)];
  await writeActivity(map);
}

/**
 * Sleep Avalanche Guard: after a wake transition every tab's activity clock is
 * reset to now, so clock jumps during sleep cannot instantly qualify every tab
 * as "idle past threshold".
 */
export async function resetAllActivity(): Promise<void> {
  const map: ActivityMap = {};
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    map[String(tab.id)] = Date.now();
  }
  await writeActivity(map);
}

export async function startWakeCooldown(durationMs: number): Promise<void> {
  await chrome.storage.session.set({ [COOLDOWN_KEY]: Date.now() + durationMs });
}

export async function isWakeCooldownActive(now: number = Date.now()): Promise<boolean> {
  const stored = await chrome.storage.session.get(COOLDOWN_KEY);
  const until = stored[COOLDOWN_KEY];
  return typeof until === 'number' && now < until;
}
