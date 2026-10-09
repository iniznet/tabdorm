import { getLastActivity } from './activity';
import { getConfig } from './config-store';
import { discardTabSafe } from './discard';
import { safeTabUrl } from './sanitize';
import { evaluateSuspension } from './suspension';

const GROUP_NONE = -1;
const PREV_ACTIVE_KEY = 'tabdorm:prevActiveByWindow';

type PrevActiveMap = Record<string, number>;

/** Pure: which group a switch should collapse, or null when none qualifies. */
export function pickCollapseTarget(prevGroupId: number, newGroupId: number): number | null {
  if (prevGroupId === GROUP_NONE) return null;
  if (newGroupId === prevGroupId) return null;
  return prevGroupId;
}

export interface IdleGroupCandidate {
  groupId: number;
  collapsed: boolean;
  /** Per-member last-activity timestamps (ms epoch). */
  memberActivity: number[];
  hasActiveTabInFocusedWindow: boolean;
}

/** Pure: uncollapsed groups idle past the threshold with no focused-window active tab. 0 disables. */
export function selectIdleGroups(candidates: IdleGroupCandidate[], thresholdMs: number, now: number): number[] {
  if (thresholdMs <= 0) return [];
  const cutoff = now - thresholdMs;
  return candidates
    .filter(
      (c) =>
        !c.collapsed &&
        !c.hasActiveTabInFocusedWindow &&
        c.memberActivity.length > 0 &&
        Math.max(...c.memberActivity) <= cutoff,
    )
    .map((c) => c.groupId);
}

async function readPrevActive(): Promise<PrevActiveMap> {
  const stored = await chrome.storage.session.get(PREV_ACTIVE_KEY);
  const value = stored[PREV_ACTIVE_KEY];
  return typeof value === 'object' && value !== null ? (value as PrevActiveMap) : {};
}

/**
 * Registers collapse-on-switch tracking and the suspendOnGroupCollapse reaction
 * point. Every collapse source (switch, idle sweep, manual user collapse)
 * funnels through tabGroups.onUpdated, so suspension behavior is defined once.
 */
export function initGroupCollapse(): void {
  chrome.tabs.onActivated.addListener((info) => {
    void handleActivation(info);
  });
  const collapsedState = new Map<number, boolean>();
  void chrome.tabGroups.query({}).then((groups) => {
    for (const group of groups) collapsedState.set(group.id, group.collapsed === true);
  });
  // (tabGroups.onUpdated receives only the group — no changeInfo — in @types/chrome 0.3.x)
  chrome.tabGroups.onUpdated.addListener((group) => {
    const wasCollapsed = collapsedState.get(group.id);
    collapsedState.set(group.id, group.collapsed === true);
    if (group.collapsed !== true || wasCollapsed === true) return;
    void suspendCollapsedGroup(group.id);
  });
  chrome.tabGroups.onRemoved.addListener((group) => {
    collapsedState.delete(group.id);
  });
}

async function handleActivation(info: { tabId: number; windowId: number }): Promise<void> {
  const map = await readPrevActive();
  const prevTabId = map[String(info.windowId)];
  map[String(info.windowId)] = info.tabId;
  await chrome.storage.session.set({ [PREV_ACTIVE_KEY]: map });
  const config = await getConfig();
  if (!config.groups.collapseOnSwitch || prevTabId === undefined || prevTabId === info.tabId) return;
  const [prevTab, newTab] = await Promise.all([
    chrome.tabs.get(prevTabId).catch(() => undefined),
    chrome.tabs.get(info.tabId).catch(() => undefined),
  ]);
  if (prevTab === undefined || newTab === undefined) return;
  const target = pickCollapseTarget(prevTab.groupId, newTab.groupId);
  if (target === null || target === GROUP_NONE) return;
  await chrome.tabGroups.update(target, { collapsed: true }).catch(() => undefined);
}

/** Discards a just-collapsed group's inactive tabs through the forced-idle matrix. */
async function suspendCollapsedGroup(groupId: number): Promise<void> {
  const config = await getConfig();
  if (!config.groups.suspendOnGroupCollapse) return;
  const [tabs, group] = await Promise.all([
    chrome.tabs.query({ groupId }),
    chrome.tabGroups.get(groupId).catch(() => undefined),
  ]);
  for (const tab of tabs) {
    if (tab.id === undefined || tab.active) continue;
    const verdict = evaluateSuspension({
      isActive: false,
      isWindowFocused: false,
      isPinned: tab.pinned === true,
      isAudible: tab.audible === true,
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
    } else if (verdict.action === 'discard') {
      await discardTabSafe(tab.id);
    }
  }
}

/** Collapses uncollapsed groups whose member tabs have all been idle past the knob. */
export async function collapseIdleGroups(): Promise<number> {
  const config = await getConfig();
  const thresholdMs = config.groups.autoCollapseOnIdleMinutes * 60_000;
  if (thresholdMs <= 0) return 0;
  const [groups, tabs, windows] = await Promise.all([
    chrome.tabGroups.query({}),
    chrome.tabs.query({}),
    chrome.windows.getAll(),
  ]);
  const focusedWindows = new Set(windows.filter((w) => w.focused).map((w) => w.id));
  const tabsByGroup = new Map<number, chrome.tabs.Tab[]>();
  for (const tab of tabs) {
    if (tab.id === undefined || tab.groupId === GROUP_NONE) continue;
    const members = tabsByGroup.get(tab.groupId) ?? [];
    members.push(tab);
    tabsByGroup.set(tab.groupId, members);
  }
  const candidates: IdleGroupCandidate[] = [];
  for (const group of groups) {
    const members = tabsByGroup.get(group.id) ?? [];
    const memberActivity = await Promise.all(
      members.filter((t) => t.id !== undefined).map((t) => getLastActivity(t.id as number)),
    );
    candidates.push({
      groupId: group.id,
      collapsed: group.collapsed === true,
      memberActivity,
      hasActiveTabInFocusedWindow: members.some((t) => t.active && focusedWindows.has(t.windowId)),
    });
  }
  const targets = selectIdleGroups(candidates, thresholdMs, Date.now());
  for (const groupId of targets) {
    await chrome.tabGroups.update(groupId, { collapsed: true }).catch(() => undefined);
  }
  return targets.length;
}
