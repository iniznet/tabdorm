import { getBatteryState } from './battery';
import { getConfig, saveConfig } from './config-store';
import { getDirtyFormTabs } from './form-guard';
import { discardTabSafe } from './discard';
import { evaluateSuspension } from './suspension';
import { safeTabUrl } from './sanitize';
import { supportsTabContext } from './menu-context';
import { hostnamePattern } from './whitelist';

const MENU_SUSPEND_TAB = 'tabdorm:suspend-tab';
const MENU_SUSPEND_OTHERS = 'tabdorm:suspend-others';
const MENU_NEVER = 'tabdorm:never-suspend';

type MenuContexts = [`${chrome.contextMenus.ContextType}`, ...`${chrome.contextMenus.ContextType}`[]];

/**
 * The tab-strip context is Chrome 150+, and an older browser rejects the value
 * outright instead of ignoring it. Page context is the pre-150 equivalent:
 * right-click inside the page body rather than on the tab.
 */
const TAB_CONTEXTS: MenuContexts = ['tab'];
const PAGE_CONTEXTS: MenuContexts = ['page'];



const MENU_ITEMS = [
  { id: MENU_SUSPEND_TAB, title: 'Suspend this tab' },
  { id: MENU_SUSPEND_OTHERS, title: 'Suspend other tabs in this window' },
  { id: MENU_NEVER, title: 'Never suspend this site' },
] as const;

/**
 * Creates the tab context menus idempotently — SW restarts wipe registrations.
 *
 * A rejected context arrives in two shapes, and both are handled here: a
 * synchronous throw out of `create`, which escapes into the extension error
 * page if uncaught, and an asynchronous `runtime.lastError` on older builds.
 * One failure switches every item to page context, because a partially created
 * menu is worse than a consistent one.
 */
export function initContextMenus(): void {
  let fellBack = false;
  const register = (contexts: MenuContexts): void => {
    for (const item of MENU_ITEMS) {
      if (fellBack) return;
      try {
        chrome.contextMenus.create({ ...item, contexts }, () => {
          if (chrome.runtime.lastError !== undefined) fallBack();
        });
      } catch {
        fallBack();
      }
    }
  };
  const fallBack = (): void => {
    if (fellBack) return;
    fellBack = true;
    chrome.contextMenus.removeAll(() => register(PAGE_CONTEXTS));
  };
  const preferred = supportsTabContext(navigator.userAgent) ? TAB_CONTEXTS : PAGE_CONTEXTS;
  chrome.contextMenus.removeAll(() => register(preferred));
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleMenuClick(info, tab);
  });
}

async function handleMenuClick(info: chrome.contextMenus.OnClickData, tab?: chrome.tabs.Tab): Promise<void> {
  if (tab?.id === undefined) return;
  if (info.menuItemId === MENU_SUSPEND_TAB) {
    await discardTabSafe(tab.id);
    return;
  }
  if (info.menuItemId === MENU_SUSPEND_OTHERS) {
    await suspendOtherTabs(tab.windowId);
    return;
  }
  if (info.menuItemId === MENU_NEVER) {
    await neverSuspendSite(tab.id, safeTabUrl(tab));
  }
}

/**
 * Immediate suspension of every inactive tab in a window, forced through the
 * same exemption matrix (idle math short-circuited via lastActivityAt=0) so
 * manual speed never bypasses pinned/audible/whitelist shields.
 */
export async function suspendOtherTabs(windowId: number): Promise<number> {
  const [config, tabs, groups] = await Promise.all([
    getConfig(),
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const dirtyTabs = config.suspension.exemptions.unsavedForms ? await getDirtyFormTabs() : new Set<number>();
  const onBattery = config.suspension.exemptions.onBattery ? (await getBatteryState()).discharging : false;
  let suspended = 0;
  for (const tab of tabs) {
    if (tab.id === undefined || tab.active) continue;
    const group =
      tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE
        ? groupById.get(tab.groupId)
        : undefined;
    const verdict = evaluateSuspension({
      isActive: false,
      isWindowFocused: false,
      isPinned: tab.pinned === true,
      isAudible: tab.audible === true,
      hasUnsavedInput: dirtyTabs.has(tab.id),
      onBatteryPower: onBattery,
      url: safeTabUrl(tab),
      groupColor: group?.color,
      groupTitle: group?.title,
      lastActivityAt: 0,
      now: Date.now(),
      cooldownActive: false,
      idleThresholdMs: config.suspension.idleThresholdMinutes * 60_000,
      exemptions: config.suspension.exemptions,
    });
    if (verdict.action === 'shield') {
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
    } else if (verdict.action === 'discard' && (await discardTabSafe(tab.id)) === 'discarded') {
      suspended += 1;
    }
  }
  return suspended;
}

/** Adds a hostname whitelist pattern and shields the tab from Memory Saver. */
async function neverSuspendSite(tabId: number, url: string): Promise<void> {
  const pattern = hostnamePattern(url);
  if (pattern === null) return;
  const config = await getConfig();
  const patterns = config.suspension.exemptions.urlPatterns;
  if (!patterns.includes(pattern)) {
    await saveConfig({
      ...config,
      suspension: {
        ...config.suspension,
        exemptions: { ...config.suspension.exemptions, urlPatterns: [...patterns, pattern] },
      },
    });
  }
  await chrome.tabs.update(tabId, { autoDiscardable: false }).catch(() => undefined);
}

/** Adds the site's hostname pattern if absent, removes it if present. */
export async function toggleWhitelistForTab(tabId: number, url: string): Promise<'added' | 'removed' | 'ignored'> {
  const pattern = hostnamePattern(url);
  if (pattern === null) return 'ignored';
  const config = await getConfig();
  const patterns = config.suspension.exemptions.urlPatterns;
  if (patterns.includes(pattern)) {
    await saveConfig({
      ...config,
      suspension: {
        ...config.suspension,
        exemptions: { ...config.suspension.exemptions, urlPatterns: patterns.filter((p) => p !== pattern) },
      },
    });
    await chrome.tabs.update(tabId, { autoDiscardable: true }).catch(() => undefined);
    return 'removed';
  }
  await neverSuspendSite(tabId, url);
  return 'added';
}
