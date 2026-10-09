const CACHE_KEY = 'tabdorm:battery';
/** Cache entries older than this are stale; UI surfaces re-report on open. */
const CACHE_TTL_MS = 600_000;

export interface BatteryState {
  /** True when the machine is confirmed to be running on battery power. */
  discharging: boolean;
  /** How the state was resolved. */
  source: 'service_worker' | 'cache' | 'unknown';
}

/** Cache written by UI surfaces (which have DOM access to getBattery). */
interface BatteryCache {
  charging: boolean;
  updatedAt: number;
}

export async function reportBatteryState(charging: boolean): Promise<void> {
  const cache: BatteryCache = { charging, updatedAt: Date.now() };
  await chrome.storage.session.set({ [CACHE_KEY]: cache });
}

/**
 * Resolves whether the machine is on battery power. The service worker probes
 * its own getBattery when available; otherwise it falls back to the most recent
 * report from a UI surface, honoring a staleness ceiling.
 */
interface BatteryManager { charging: boolean }
type BatteryNavigator = Navigator & { getBattery?: () => Promise<BatteryManager> };

export async function getBatteryState(): Promise<BatteryState> {
  const nav = navigator as BatteryNavigator;
  if (typeof nav.getBattery === 'function') {
    try {
      const battery = await nav.getBattery();
      return { discharging: battery.charging === false, source: 'service_worker' };
    } catch {
      // fall through to cache
    }
  }
  const stored = await chrome.storage.session.get(CACHE_KEY);
  const cache = stored[CACHE_KEY] as BatteryCache | undefined;
  if (cache !== undefined && Date.now() - cache.updatedAt <= CACHE_TTL_MS) {
    return { discharging: cache.charging === false, source: 'cache' };
  }
  return { discharging: false, source: 'unknown' };
}