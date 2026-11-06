import { getLastActivity } from './activity';
import { getBatteryState } from './battery';
import { getConfig } from './config-store';
import { getDirtyFormTabs } from './form-guard';
import { discardTabSafe } from './discard';
import { safeTabUrl } from './sanitize';
import { evaluateSuspension } from './suspension';
import {
  canCollapseGroup,
  pickCollapseTarget,
  selectIdleGroups,
  type IdleGroupCandidate,
} from './group-collapse-rules';
import { applyActiveGroupOrder } from './move-groups';

const GROUP_NONE = -1;
const PREV_ACTIVE_KEY = 'tabdorm:prevActiveByWindow';

type PrevActiveMap = Record<string, number>;

/**
 * Serialized read-modify-write chain. Activations arrive in bursts when a window
 * restores or several tabs open at once, and chrome.storage.session offers no
 * transactional update: two parallel handlers read the same map and the later write
 * wins, so the real previous tab is lost and collapse-on-switch goes quiet.
 */
let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task, task);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
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
  const prevTabId = await serialize(async () => {
    const map = await readPrevActive();
    const previous = map[String(info.windowId)];
    map[String(info.windowId)] = info.tabId;
    await chrome.storage.session.set({ [PREV_ACTIVE_KEY]: map });
    return previous;
  });
  const config = await getConfig();
  if (config.groups.collapseOnSwitch && prevTabId !== undefined && prevTabId !== info.tabId) {
    await collapseLeftGroup(prevTabId, info.tabId);
  }
  await applyActiveGroupOrder(info.windowId, info.tabId, config.groups.orderOnActivate);
}

/** Collapse-on-switch step: fold the group the user just left. */
async function collapseLeftGroup(prevTabId: number, newTabId: number): Promise<void> {
  const [prevTab, newTab] = await Promise.all([
    chrome.tabs.get(prevTabId).catch(() => undefined),
    chrome.tabs.get(newTabId).catch(() => undefined),
  ]);
  if (prevTab === undefined || newTab === undefined) return;
  const target = pickCollapseTarget(prevTab.groupId, newTab.groupId);
  if (target === null || target === GROUP_NONE) return;
  await collapseGroupIfSafe(target);
}

/**
 * The single collapse write. Every source funnels here, so the invariant that a
 * collapse never takes the active tab with it lives once instead of per caller.
 *
 * The guard reads live state at write time on purpose. Handlers await storage and
 * config first, so a burst of activations leaves their decisions stale. Folding the
 * group the user has just returned to makes Chromium activate a neighbour, which
 * fires another activation and folds the next group: one stale decision cascades
 * until the strip has collapsed every group at once.
 */
export async function collapseGroupIfSafe(groupId: number): Promise<boolean> {
  const [group, tabs] = await Promise.all([
    chrome.tabGroups.get(groupId).catch(() => undefined),
    chrome.tabs.query({ groupId }).catch(() => [] as chrome.tabs.Tab[]),
  ]);
  const allowed = canCollapseGroup({
    exists: group !== undefined,
    collapsed: group?.collapsed === true,
    holdsActiveTab: tabs.some((tab) => tab.active),
  });
  if (!allowed) return false;
  try {
    await chrome.tabGroups.update(groupId, { collapsed: true });
    return true;
  } catch {
    return false;
  }
}

/** Discards a just-collapsed group's inactive tabs through the forced-idle matrix. */
async function suspendCollapsedGroup(groupId: number): Promise<void> {
  const config = await getConfig();
  if (!config.groups.suspendOnGroupCollapse) return;
  const [tabs, group, dirtyTabs, battery] = await Promise.all([
    chrome.tabs.query({ groupId }),
    chrome.tabGroups.get(groupId).catch(() => undefined),
    config.suspension.exemptions.unsavedForms ? getDirtyFormTabs() : Promise.resolve(new Set<number>()),
    config.suspension.exemptions.onBattery ? getBatteryState() : Promise.resolve({ discharging: false } as const),
  ]);
  for (const tab of tabs) {
    if (tab.id === undefined || tab.active) continue;
    const verdict = evaluateSuspension({
      isActive: false,
      isWindowFocused: false,
      isPinned: tab.pinned === true,
      isAudible: tab.audible === true,
      hasUnsavedInput: dirtyTabs.has(tab.id),
      onBatteryPower: battery.discharging,
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
  let collapsed = 0;
  for (const groupId of targets) {
    if (await collapseGroupIfSafe(groupId)) collapsed += 1;
  }
  return collapsed;
}
