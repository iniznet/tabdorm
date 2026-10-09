import type { AutoRouteRule } from '@/types';
import { getConfig } from './config-store';
import { isBenignRuntimeError } from './discard';

/**
 * Compiles an AutoRouteRule pattern into a RegExp.
 * - "regexp:<source>" is used verbatim (case-insensitive).
 * - Anything else is match-pattern-lite: "*." becomes an optional single-level
 *   subdomain, other "*"s become ".*", and a scheme is implied when absent.
 *   "*.github.com/*" therefore matches both https://github.com/x and subdomains.
 */
export function ruleToRegExp(pattern: string): RegExp | null {
  try {
    if (pattern.startsWith('regexp:')) return new RegExp(pattern.slice('regexp:'.length), 'i');
    let source = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
    source = source.split('*\\.').join('(?:[^/]+\\.)?');
    source = source.split('*').join('.*');
    if (!pattern.includes('://')) source = `https?://${source}`;
    return new RegExp(`^${source}$`, 'i');
  } catch {
    console.warn(`[tabdorm] invalid routing pattern ignored: ${pattern}`);
    return null;
  }
}

export function matchesRule(url: string, rule: AutoRouteRule): boolean {
  const matcher = ruleToRegExp(rule.pattern);
  return matcher !== null && matcher.test(url);
}

/** Finds the first enabled rule whose pattern matches the committed URL. */
export function matchRuleForUrl(url: string, rules: readonly AutoRouteRule[]): AutoRouteRule | null {
  for (const rule of rules) {
    if (rule.enabled && matchesRule(url, rule)) return rule;
  }
  return null;
}

/**
 * Domain Auto-Routing entry point. Caller guarantees frameId === 0.
 * Pinned tabs are always exempt; already-grouped tabs are exempt unless
 * reRouteAlreadyGrouped is enabled. The tab joins an existing group with the
 * same title + color in its window, or a new group is created for it.
 */
export async function routeCommittedNavigation(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  const url = details.url ?? '';
  if (!/^https?:/i.test(url)) return;
  const config = await getConfig();
  const routing = config.groups.routing;
  if (!routing.enabled || routing.rules.length === 0) return;
  const rule = matchRuleForUrl(url, routing.rules);
  if (!rule) return;

  await routeSingleTab(details.tabId, rule, routing.reRouteAlreadyGrouped);
}

/**
 * Applies one rule to one tab: pinned tabs and (unless reRouteAlreadyGrouped)
 * already-grouped tabs are exempt. Shared by the navigation-commit path and
 * the backfill pass so both entry points enforce identical guard rails.
 */
async function routeSingleTab(
  tabId: number,
  rule: AutoRouteRule,
  reRouteAlreadyGrouped: boolean,
): Promise<boolean> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return false;
  }
  if (tab.id === undefined) return false;
  if (tab.pinned) return false;
  if (tab.windowId === chrome.windows.WINDOW_ID_NONE) return false;
  const isGrouped = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  if (isGrouped && !reRouteAlreadyGrouped) return false;
  try {
    await attachTabToRuleGroup(tab.id, tab.windowId, rule);
  } catch (error) {
    if (!isBenignRuntimeError(error)) {
      console.warn('[tabdorm] auto-routing failed.', error);
    }
    return false;
  }
  return true;
}

async function attachTabToRuleGroup(
  tabId: number,
  windowId: number,
  rule: AutoRouteRule,
): Promise<void> {
  const existing = await chrome.tabGroups.query({
    windowId,
    title: rule.groupTitle,
    color: rule.groupColor,
  });
  const target = existing.at(0);
  if (target !== undefined) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: target.id });
    if (rule.autoCollapse === true && target.collapsed === false) {
      await chrome.tabGroups.update(target.id, { collapsed: true });
    }
    return;
  }
  const newGroupId = await chrome.tabs.group({
    tabIds: [tabId],
    createProperties: { windowId },
  });
  await chrome.tabGroups.update(newGroupId, {
    title: rule.groupTitle,
    color: rule.groupColor,
    collapsed: rule.autoCollapse === true,
  });
}

/**
 * Backfill pass: applies the enabled rules to already-open tabs so a newly
 * added rule (or a fresh install/reload) groups the existing population
 * immediately instead of waiting for each tab to navigate again.
 */
export async function backfillRouting(): Promise<{ routed: number }> {
  const config = await getConfig();
  const routing = config.groups.routing;
  if (!routing.enabled || routing.rules.length === 0) return { routed: 0 };
  const tabs = await chrome.tabs.query({});
  let routed = 0;
  for (const tab of tabs) {
    const url = tab.url ?? '';
    if (!/^https?:/i.test(url) || tab.id === undefined) continue;
    const rule = matchRuleForUrl(url, routing.rules);
    if (rule === null) continue;
    const didRoute = await routeSingleTab(tab.id, rule, routing.reRouteAlreadyGrouped);
    if (didRoute) routed += 1;
  }
  return { routed };
}
