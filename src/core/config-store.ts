import { resolveConfig, type TabDormConfig } from '@/types';

const CONFIG_KEY = 'tabdormConfig';

let cache: TabDormConfig | null = null;

/** Reads the user config from chrome.storage.sync, resolved over safe defaults. */
export async function getConfig(): Promise<TabDormConfig> {
  if (cache) return cache;
  try {
    const stored = await chrome.storage.sync.get(CONFIG_KEY);
    cache = resolveConfig(stored[CONFIG_KEY]);
  } catch (error) {
    console.warn('[tabdorm] config read failed; using defaults.', error);
    cache = resolveConfig(undefined);
  }
  return cache;
}

/** Persists the full resolved config (first run seeds defaults). */
export async function saveConfig(config: TabDormConfig): Promise<void> {
  try {
    await chrome.storage.sync.set({ [CONFIG_KEY]: config });
  } catch (error) {
    throw new Error(
      `Saving settings failed (chrome.storage.sync quota or sync error): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  cache = config;
}

/** Seeds defaults on first install; never overwrites an existing user config. */
export async function ensureConfigPersisted(): Promise<void> {
  const stored = await chrome.storage.sync.get(CONFIG_KEY);
  if (stored[CONFIG_KEY] !== undefined) return;
  await saveConfig(resolveConfig(undefined));
}

/**
 * MUST be called synchronously during service-worker startup so live edits in
 * chrome.storage.sync invalidate the cache without a worker restart.
 */
export function registerConfigInvalidation(): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes[CONFIG_KEY] !== undefined) cache = null;
  });
}
