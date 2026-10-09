import type { GroupColor, TabDormConfig } from '@/types';
import { getLastActivity, isWakeCooldownActive } from './activity';
import { ruleToRegExp } from './auto-route';
import { getConfig } from './config-store';
import { discardTabSafe } from './discard';
import { safeTabUrl } from './sanitize';

export const SWEEP_ALARM = 'tabdorm:sweep';

export type SuspensionAction = 'discard' | 'skip' | 'shield' | 'unshield';

export interface SuspensionVerdict {
  action: SuspensionAction;
  reason: string;
}

/** Everything evaluateSuspension needs, pre-resolved — pure and unit-testable. */
export interface SuspensionInput {
  isActive: boolean;
  /** Whether the tab's window is the focused window. */
  isWindowFocused: boolean;
  isPinned: boolean;
  isAudible: boolean;
  url: string;
  groupColor?: GroupColor;
  groupTitle?: string;
  lastActivityAt: number;
  now: number;
  cooldownActive: boolean;
  idleThresholdMs: number;
  exemptions: {
    pinnedTabs: boolean;
    audibleTabs: boolean;
    activeInOtherWindows: boolean;
    urlPatterns: readonly string[];
    protectedGroupColors: readonly GroupColor[];
    protectedGroupTitles: readonly string[];
  };
}

/**
 * Pure suspension decision matrix. Order matters: hard skips first, then the
 * AutoDiscardable Shielding whitelist (protected content is shielded from
 * Chrome's Memory Saver and never suspended), then the idle-threshold check.
 */
export function evaluateSuspension(input: SuspensionInput): SuspensionVerdict {
  if (input.isActive && input.isWindowFocused) return { action: 'skip', reason: 'active_tab' };
  if (input.cooldownActive) return { action: 'skip', reason: 'wake_cooldown' };
  if (input.isActive && input.exemptions.activeInOtherWindows) {
    // Active tab of an unfocused window — the user may bounce straight back.
    return { action: 'skip', reason: 'active_in_other_window' };
  }
  if (input.isPinned && input.exemptions.pinnedTabs) return { action: 'skip', reason: 'pinned_exempt' };
  if (input.isAudible && input.exemptions.audibleTabs) return { action: 'skip', reason: 'audible_exempt' };
  if (input.groupColor !== undefined && input.exemptions.protectedGroupColors.includes(input.groupColor)) {
    return { action: 'shield', reason: 'protected_group_color' };
  }
  if (input.groupTitle !== undefined && input.exemptions.protectedGroupTitles.includes(input.groupTitle)) {
    return { action: 'shield', reason: 'protected_group_title' };
  }
  if (matchesWhitelist(input.url, input.exemptions.urlPatterns)) {
    return { action: 'shield', reason: 'url_whitelisted' };
  }
  if (input.now - input.lastActivityAt >= input.idleThresholdMs) {
    return { action: 'discard', reason: 'idle_threshold' };
  }
  return { action: 'unshield', reason: 'not_idle' };
}

function matchesWhitelist(url: string, patterns: readonly string[]): boolean {
  for (const pattern of patterns) {
    const matcher = ruleToRegExp(pattern);
    if (matcher !== null && matcher.test(url)) return true;
  }
  return false;
}

export interface SweepSummary {
  status: 'ran' | 'disabled' | 'cooldown';
  evaluated: number;
  discarded: number;
  shielded: number;
  unshielded: number;
}

/** Runs one suspension sweep across all normal, non-incognito windows. */
export async function runSweepOnce(): Promise<SweepSummary> {
  const config = await getConfig();
  if (!config.suspension.enabled) {
    return { status: 'disabled', evaluated: 0, discarded: 0, shielded: 0, unshielded: 0 };
  }
  if (await isWakeCooldownActive()) {
    return { status: 'cooldown', evaluated: 0, discarded: 0, shielded: 0, unshielded: 0 };
  }
  const [tabs, groups, windows] = await Promise.all([
    chrome.tabs.query({}),
    chrome.tabGroups.query({}),
    chrome.windows.getAll({ populate: false }),
  ]);
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const normalWindowIds = new Set(windows.filter((w) => w.incognito === false && w.type === 'normal').map((w) => w.id));
  const windowById = new Map(windows.map((w) => [w.id, w]));
  const summary: SweepSummary = { status: 'ran', evaluated: 0, discarded: 0, shielded: 0, unshielded: 0 };
  const exclusive = config.suspension.memorySaverPolicy === 'exclusive';
  const now = Date.now();

  for (const tab of tabs) {
    if (tab.id === undefined || tab.windowId === undefined) continue;
    if (!normalWindowIds.has(tab.windowId)) continue;
    const group = tab.groupId !== undefined && tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? groupById.get(tab.groupId) : undefined;
    const verdict = evaluateSuspension({
      isActive: tab.active === true,
      isWindowFocused: windowById.get(tab.windowId)?.focused === true,
      isPinned: tab.pinned === true,
      isAudible: tab.audible === true,
      url: safeTabUrl(tab),
      groupColor: group?.color,
      groupTitle: group?.title,
      lastActivityAt: await getLastActivity(tab.id),
      now,
      cooldownActive: false,
      idleThresholdMs: config.suspension.idleThresholdMinutes * 60_000,
      exemptions: config.suspension.exemptions,
    });
    summary.evaluated += 1;
    if (verdict.action === 'shield' || exclusive) {
      await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
      summary.shielded += 1;
    } else if (verdict.action === 'discard') {
      if ((await discardTabSafe(tab.id)) === 'discarded') summary.discarded += 1;
    } else if (verdict.action === 'unshield') {
      await chrome.tabs.update(tab.id, { autoDiscardable: true }).catch(() => undefined);
      summary.unshielded += 1;
    }
  }
  return summary;
}

/** Creates or clears the periodic sweep alarm to match the current config. */
export async function syncSweepAlarm(config: TabDormConfig): Promise<void> {
  const existing = await chrome.alarms.get(SWEEP_ALARM);
  if (config.suspension.enabled) {
    if (existing === undefined || existing.periodInMinutes !== config.suspension.sweepIntervalMinutes) {
      await chrome.alarms.clear(SWEEP_ALARM);
      await chrome.alarms.create(SWEEP_ALARM, { periodInMinutes: config.suspension.sweepIntervalMinutes });
    }
  } else if (existing !== undefined) {
    await chrome.alarms.clear(SWEEP_ALARM);
  }
}


