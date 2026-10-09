import { getBatteryState } from './battery';
import { getConfig, saveConfig } from './config-store';
import { getDirtyFormTabs } from './form-guard';
import { discardTabSafe } from './discard';
import { evaluateSuspension } from './suspension';
import { safeTabUrl } from './sanitize';
import { hostnamePattern } from './whitelist';

const MENU_SUSPEND_TAB = 'tabdorm:suspend-tab';
const MENU_SUSPEND_OTHERS = 'tabdorm:suspend-others';
const MENU_NEVER = 'tabdorm:never-suspend';

/** Creates the tab context menus idempotently — SW restarts wipe registrations. */
export function initContextMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_SUSPEND_TAB, title: 'Suspend this tab', contexts: ['tab'] });
    chrome.contextMenus.create({
      id: MENU_SUSPEND_OTHERS,
      title: 'Suspend other tabs in this window',
      contexts: ['tab'],
    });
    chrome.contextMenus.create({ id: MENU_NEVER, title: 'Never suspend this site', contexts: ['tab'] });
  });
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
