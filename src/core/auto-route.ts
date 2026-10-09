import type { AutoRouteRule } from '@/types';
import { baseDomainOf, syntheticGroupForUrl, type GroupTarget } from './domain-groups';
import { getConfig } from './config-store';
import { isBenignRuntimeError } from './discard';

/** Identity of the optional bucket group that collects below-threshold sites. */
const BUCKET_TITLE = 'Ungrouped';
const BUCKET_TARGET: GroupTarget = { groupTitle: BUCKET_TITLE, groupColor: 'grey', autoCollapse: false };

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

export interface GroupDecision {
  target: GroupTarget;
  /** True when the target comes from an explicit user rule (bypasses the min-tabs threshold). */
  fromRule: boolean;
}

/**
 * Group target for a URL under the current routing config: the first matching
 * user rule wins; with autoGroupByDomain the site's own group is the fallback.
 * Returns null when nothing applies.
 */
export function decideGroupTarget(
  url: string,
  routing: { autoGroupByDomain: boolean; rules: readonly AutoRouteRule[] },
): GroupDecision | null {
  const rule = matchRuleForUrl(url, routing.rules);
  if (rule !== null) {
    return {
      target: { groupTitle: rule.groupTitle, groupColor: rule.groupColor, autoCollapse: rule.autoCollapse === true },
      fromRule: true,
    };
  }
  if (!routing.autoGroupByDomain) return null;
  const synthetic = syntheticGroupForUrl(url);
  return synthetic === null ? null : { target: synthetic, fromRule: false };
}

/** Same-site key: base domain of an http(s) URL, else null. */
function siteKeyOf(url: string): string | null {
  if (!/^https?:/i.test(url)) return null;
  try {
    return baseDomainOf(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * Domain Auto-Routing entry point. Caller guarantees frameId === 0.
 * Rule matches route immediately (explicit user intent bypasses the
 * min-tabs threshold). Synthetic site matches honor the threshold: below
 * minTabsPerGroup the tab is either bucketed into "Ungrouped" or left alone,
 * and a debounced backfill promotes earlier lonely siblings once the count
 * crosses the threshold.
 */
export async function routeCommittedNavigation(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  const url = details.url ?? '';
  if (!/^https?:/i.test(url)) return;
  const config = await getConfig();
  const routing = config.groups.routing;
  if (!routing.enabled) return;
  const decision = decideGroupTarget(url, routing);
  if (decision === null) return;

  if (decision.fromRule) {
    await routeSingleTab(details.tabId, decision.target, routing.reRouteAlreadyGrouped);
    return;
  }

  let tab: chrome.tabs.Tab;
  try {
    tab = await chrome.tabs.get(details.tabId);
  } catch {
    return;
  }
  if (tab.id === undefined || tab.pinned) return;
  if (tab.windowId === undefined || tab.windowId === chrome.windows.WINDOW_ID_NONE) return;
  const site = siteKeyOf(url);
  if (site === null) return;

  const sameSiteCount = await countSiteTabsInWindow(tab.windowId, site, decision.target, routing);
  if (sameSiteCount >= routing.minTabsPerGroup) {
    const routed = await routeSingleTab(tab.id, decision.target, routing.reRouteAlreadyGrouped);
    if (routed) scheduleSiblingBackfill();
  } else if (routing.bucketLonelyTabs) {
    await routeSingleTab(tab.id, BUCKET_TARGET, routing.reRouteAlreadyGrouped);
  }
}

/**
 * Counts the window's tabs that belong to the same site and are candidates
 * for the target group: ungrouped, already in the target group, or sitting
 * in the "Ungrouped" bucket waiting for promotion. Tabs a user placed in
 * other groups are counted as intentional and ignored.
 */
async function countSiteTabsInWindow(
  windowId: number,
  site: string,
  target: GroupTarget,
  routing: { minTabsPerGroup: number; autoGroupByDomain: boolean; rules: readonly AutoRouteRule[] },
): Promise<number> {
  const [windowTabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId }),
  ]);
  const groupInfo = new Map<number, string>();
  for (const group of groups) {
    if (group.id !== undefined) groupInfo.set(group.id, `${group.title}\u0000${String(group.color)}`);
  }
  const targetKey = `${target.groupTitle}\u0000${target.groupColor}`;
  const bucketKey = `${BUCKET_TITLE}\u0000grey`;
  let count = 0;
  for (const tab of windowTabs) {
    if (tab.id === undefined || tab.pinned) continue;
    if (siteKeyOf(tab.url ?? '') !== site) continue;
    const grouped = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
    if (!grouped) {
      count += 1;
      continue;
    }
    const current = groupInfo.get(tab.groupId);
    if (current === undefined) continue;
    if (current === targetKey) count += 1;
    else if (current === bucketKey) count += 1;
  }
  return count;
}

/**
 * Applies one target to one tab. Guard rails shared by every entry point:
 * pinned tabs exempt; already in the correct group is a no-op; the
 * "Ungrouped" bucket never blocks promotion into the real site group;
 * any other existing group is respected unless reRouteAlreadyGrouped is on.
 */
async function routeSingleTab(
  tabId: number,
  target: GroupTarget,
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
  if (tab.windowId === undefined || tab.windowId === chrome.windows.WINDOW_ID_NONE) return false;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    try {
      const current = await chrome.tabGroups.get(tab.groupId);
      if (current.title === target.groupTitle && String(current.color) === target.groupColor) return false;
      const inBucket = current.title === BUCKET_TITLE && String(current.color) === 'grey';
      if (!inBucket && !reRouteAlreadyGrouped) return false;
    } catch {
      return false;
    }
  }
  try {
    await attachTabToGroup(tab.id, tab.windowId, target);
  } catch (error) {
    if (!isBenignRuntimeError(error)) {
      console.warn('[tabdorm] auto-routing failed.', error);
    }
    return false;
  }
  return true;
}

async function attachTabToGroup(
  tabId: number,
  windowId: number,
  target: GroupTarget,
): Promise<void> {
  const existing = await chrome.tabGroups.query({
    windowId,
    title: target.groupTitle,
    color: target.groupColor,
  });
  const group = existing.at(0);
  if (group !== undefined) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: group.id });
    if (target.autoCollapse && group.collapsed === false) {
      await chrome.tabGroups.update(group.id, { collapsed: true });
    }
    return;
  }
  const newGroupId = await chrome.tabs.group({
    tabIds: [tabId],
    createProperties: { windowId },
  });
  await chrome.tabGroups.update(newGroupId, {
    title: target.groupTitle,
    color: target.groupColor,
    collapsed: target.autoCollapse,
  });
}

/**
 * Backfill pass — the routing reconciler. One pass computes per-(window,
 * target) counts, then: rule targets always route; site targets route when
 * they meet minTabsPerGroup; below-threshold sites are either bucketed into
 * "Ungrouped" (bucketLonelyTabs) or left untouched. Bucket members promote
 * into their real site group as soon as its count qualifies.
 */
export async function backfillRouting(): Promise<{ routed: number }> {
  const config = await getConfig();
  const routing = config.groups.routing;
  if (!routing.enabled) return { routed: 0 };

  const [tabs, groups] = await Promise.all([chrome.tabs.query({}), chrome.tabGroups.query({})]);
  const groupInfo = new Map<number, string>();
  for (const group of groups) {
    if (group.id !== undefined) groupInfo.set(group.id, `${group.title}\u0000${String(group.color)}`);
  }

  interface Candidate {
    tabId: number;
    target: GroupTarget;
    fromRule: boolean;
    alreadyCorrect: boolean;
    inBucket: boolean;
  }
  const sites = new Map<string, { count: number; candidates: Candidate[] }>();
  for (const tab of tabs) {
    const url = tab.url ?? '';
    if (tab.id === undefined || tab.windowId === undefined) continue;
    if (tab.windowId === chrome.windows.WINDOW_ID_NONE) continue;
    const site = siteKeyOf(url);
    if (site === null) continue;
    if (tab.pinned) continue;
    const decision = decideGroupTarget(url, routing);
    if (decision === null) continue;
    const targetKey = `${decision.target.groupTitle}\u0000${decision.target.groupColor}`;
    const bucketKey = `${BUCKET_TITLE}\u0000grey`;
    const current = tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupInfo.get(tab.groupId) : undefined;
    const alreadyCorrect = current === targetKey;
    const inBucket = current === bucketKey;
    if (current !== undefined && !alreadyCorrect && !inBucket && !routing.reRouteAlreadyGrouped) continue;
    const key = `${tab.windowId}\u0000${targetKey}`;
    const entry = sites.get(key);
    const candidate: Candidate = { tabId: tab.id, target: decision.target, fromRule: decision.fromRule, alreadyCorrect, inBucket };
    if (entry === undefined) sites.set(key, { count: 1, candidates: [candidate] });
    else {
      entry.count += 1;
      entry.candidates.push(candidate);
    }
  }

  let routed = 0;
  for (const entry of sites.values()) {
    const first = entry.candidates[0];
    if (first === undefined) continue;
    const qualifies = first.fromRule || entry.count >= routing.minTabsPerGroup;
    const target = qualifies ? first.target : BUCKET_TARGET;
    if (!qualifies && !routing.bucketLonelyTabs) continue;
    for (const candidate of entry.candidates) {
      if (candidate.alreadyCorrect) continue;
      const didRoute = await routeSingleTab(candidate.tabId, target, routing.reRouteAlreadyGrouped);
      if (didRoute) routed += 1;
    }
  }
  return { routed };
}

/** One reconciler pass per navigation burst; avoids re-scanning per commit. */
let siblingTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleSiblingBackfill(): void {
  if (siblingTimer !== undefined) clearTimeout(siblingTimer);
  siblingTimer = setTimeout(() => {
    siblingTimer = undefined;
    void backfillRouting();
  }, 400);
}
