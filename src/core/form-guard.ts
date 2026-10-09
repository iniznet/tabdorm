import type { TabDormConfig } from '@/types';

const DIRTY_KEY = 'tabdorm:dirtyForms';
const SCRIPT_ID = 'tabdorm-form-guard';

type DirtyMap = Record<string, true>;

async function readDirty(): Promise<DirtyMap> {
  const stored = await chrome.storage.session.get(DIRTY_KEY);
  const value = stored[DIRTY_KEY];
  return typeof value === 'object' && value !== null ? (value as DirtyMap) : {};
}

/** Records that a tab has unsaved form input (draft protection). */
export async function markDirtyForm(tabId: number): Promise<void> {
  const map = await readDirty();
  if (map[String(tabId)] === true) return;
  map[String(tabId)] = true;
  await chrome.storage.session.set({ [DIRTY_KEY]: map });
}

/** A submitted form no longer holds unsaved input. */
export async function clearDirtyForm(tabId: number): Promise<void> {
  const map = await readDirty();
  if (map[String(tabId)] === undefined) return;
  delete map[String(tabId)];
  await chrome.storage.session.set({ [DIRTY_KEY]: map });
}

/** Tab ids currently holding unsaved form input. */
export async function getDirtyFormTabs(): Promise<Set<number>> {
  const map = await readDirty();
  return new Set(Object.keys(map).map(Number));
}

/**
 * Registers or removes the opt-in draft-protection content script. The host
 * permission must already be granted (UI asks via chrome.permissions.request);
 * registration is never attempted without it.
 */
export async function applyFormGuardSync(config: TabDormConfig): Promise<void> {
  try {
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const exists = registered.some((s) => s.id === SCRIPT_ID);
    if (config.suspension.exemptions.unsavedForms) {
      const granted = await chrome.permissions.contains({ origins: ['<all_urls>'] });
      if (!granted) return;
      if (!exists) {
        await chrome.scripting.registerContentScripts([{
          id: SCRIPT_ID,
          matches: ['<all_urls>'],
          js: ['form-guard.js'],
          runAt: 'document_start',
          persistAcrossSessions: true,
        }]);
      }
    } else if (exists) {
      await chrome.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    }
  } catch (error) {
    console.warn('[tabdorm] form-guard sync failed.', error);
  }
}