import { VALID_GROUP_COLORS, type AutoRouteRule, type TabDormConfig } from './config';

/**
 * Safe defaults for every configurable knob. Nothing in the codebase may hardcode
 * an interval, delay, threshold, or routing rule — always read from TabDormConfig.
 */
export const DEFAULT_TAB_DORM_CONFIG: TabDormConfig = {
  schemaVersion: 1,
  suspension: {
    enabled: false,
    idleThresholdMinutes: 30,
    sweepIntervalMinutes: 1,
    memorySaverPolicy: 'cooperative',
    wakeCooldownMs: 120_000,
    exemptions: {
      pinnedTabs: true,
      audibleTabs: true,
      activeInOtherWindows: true,
      urlPatterns: [],
      protectedGroupColors: [],
      protectedGroupTitles: [],
    },
    visualCue: {
      enabled: false,
      prefix: '💤 ',
    },
  },
  groups: {
    suspendOnGroupCollapse: false,
    autoCollapseOnIdleMinutes: 0,
    routing: {
      enabled: true,
      reRouteAlreadyGrouped: false,
      rules: [],
    },
  },
  restoration: {
    batchSize: 10,
    delayBetweenTabsMs: 50,
    restoreAsDiscarded: true,
    restoreGroupsCollapsed: true,
    clampToBounds: true,
  },
  snapshots: {
    enabled: true,
    intervalMinutes: 15,
    maxSnapshotsRetained: 200,
    retentionDays: 30,
    autoBackupDownloadDays: 7,
  },
};

const NUMERIC_BOUNDS = {
  idleThresholdMinutes: { min: 1, max: 10_080 },
  sweepIntervalMinutes: { min: 1, max: 1_440 },
  wakeCooldownMs: { min: 0, max: 3_600_000 },
  autoCollapseOnIdleMinutes: { min: 0, max: 10_080 },
  batchSize: { min: 1, max: 100 },
  delayBetweenTabsMs: { min: 0, max: 5_000 },
  intervalMinutes: { min: 1, max: 1_440 },
  maxSnapshotsRetained: { min: 1, max: 10_000 },
  retentionDays: { min: 1, max: 3_650 },
  autoBackupDownloadDays: { min: 0, max: 365 },
} as const;

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function readBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function isGroupColor(value: unknown): value is TabDormConfig['suspension']['exemptions']['protectedGroupColors'][number] {
  return (
    typeof value === 'string' &&
    (VALID_GROUP_COLORS as readonly string[]).includes(value)
  );
}

function readRules(value: unknown): AutoRouteRule[] {
  if (!Array.isArray(value)) return [];
  const rules: AutoRouteRule[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue;
    const candidate = raw as Record<string, unknown>;
    const pattern = readString(candidate['pattern'], '');
    if (pattern.length === 0) continue;
    rules.push({
      id: readString(candidate['id'], crypto.randomUUID()),
      enabled: readBool(candidate['enabled'], true),
      pattern,
      groupTitle: readString(candidate['groupTitle'], 'Group'),
      groupColor: isGroupColor(candidate['groupColor']) ? candidate['groupColor'] : 'grey',
      autoCollapse: readBool(candidate['autoCollapse'], false),
    });
  }
  return rules;
}

/** Deep-merges a stored (possibly corrupt or stale) config over safe defaults. */
export function resolveConfig(raw: unknown): TabDormConfig {
  const source =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const s = readObject(source['suspension']);
  const ex = readObject(s['exemptions']);
  const vc = readObject(s['visualCue']);
  const g = readObject(source['groups']);
  const r = readObject(g['routing']);
  const rest = readObject(source['restoration']);
  const snap = readObject(source['snapshots']);
  const b = NUMERIC_BOUNDS;

  return {
    schemaVersion: clampNumber(source['schemaVersion'], DEFAULT_TAB_DORM_CONFIG.schemaVersion, 1, 99),
    suspension: {
      enabled: readBool(s['enabled'], DEFAULT_TAB_DORM_CONFIG.suspension.enabled),
      idleThresholdMinutes: clampNumber(s['idleThresholdMinutes'], DEFAULT_TAB_DORM_CONFIG.suspension.idleThresholdMinutes, b.idleThresholdMinutes.min, b.idleThresholdMinutes.max),
      sweepIntervalMinutes: clampNumber(s['sweepIntervalMinutes'], DEFAULT_TAB_DORM_CONFIG.suspension.sweepIntervalMinutes, b.sweepIntervalMinutes.min, b.sweepIntervalMinutes.max),
      memorySaverPolicy:
        s['memorySaverPolicy'] === 'exclusive' || s['memorySaverPolicy'] === 'custom_shield'
          ? s['memorySaverPolicy']
          : 'cooperative',
      wakeCooldownMs: clampNumber(s['wakeCooldownMs'], DEFAULT_TAB_DORM_CONFIG.suspension.wakeCooldownMs, b.wakeCooldownMs.min, b.wakeCooldownMs.max),
      exemptions: {
        pinnedTabs: readBool(ex['pinnedTabs'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.pinnedTabs),
        audibleTabs: readBool(ex['audibleTabs'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.audibleTabs),
        activeInOtherWindows: readBool(ex['activeInOtherWindows'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.activeInOtherWindows),
        urlPatterns: readStringArray(ex['urlPatterns']),
        protectedGroupColors: Array.isArray(ex['protectedGroupColors'])
          ? ex['protectedGroupColors'].filter(isGroupColor)
          : [],
        protectedGroupTitles: readStringArray(ex['protectedGroupTitles']),
      },
      visualCue: {
        enabled: readBool(vc['enabled'], DEFAULT_TAB_DORM_CONFIG.suspension.visualCue.enabled),
        prefix: readString(vc['prefix'], DEFAULT_TAB_DORM_CONFIG.suspension.visualCue.prefix),
      },
    },
    groups: {
      suspendOnGroupCollapse: readBool(g['suspendOnGroupCollapse'], DEFAULT_TAB_DORM_CONFIG.groups.suspendOnGroupCollapse),
      autoCollapseOnIdleMinutes: clampNumber(g['autoCollapseOnIdleMinutes'], DEFAULT_TAB_DORM_CONFIG.groups.autoCollapseOnIdleMinutes, b.autoCollapseOnIdleMinutes.min, b.autoCollapseOnIdleMinutes.max),
      routing: {
        enabled: readBool(r['enabled'], DEFAULT_TAB_DORM_CONFIG.groups.routing.enabled),
        reRouteAlreadyGrouped: readBool(r['reRouteAlreadyGrouped'], DEFAULT_TAB_DORM_CONFIG.groups.routing.reRouteAlreadyGrouped),
        rules: readRules(r['rules']),
      },
    },
    restoration: {
      batchSize: clampNumber(rest['batchSize'], DEFAULT_TAB_DORM_CONFIG.restoration.batchSize, b.batchSize.min, b.batchSize.max),
      delayBetweenTabsMs: clampNumber(rest['delayBetweenTabsMs'], DEFAULT_TAB_DORM_CONFIG.restoration.delayBetweenTabsMs, b.delayBetweenTabsMs.min, b.delayBetweenTabsMs.max),
      restoreAsDiscarded: readBool(rest['restoreAsDiscarded'], DEFAULT_TAB_DORM_CONFIG.restoration.restoreAsDiscarded),
      restoreGroupsCollapsed: readBool(rest['restoreGroupsCollapsed'], DEFAULT_TAB_DORM_CONFIG.restoration.restoreGroupsCollapsed),
      clampToBounds: readBool(rest['clampToBounds'], DEFAULT_TAB_DORM_CONFIG.restoration.clampToBounds),
    },
    snapshots: {
      enabled: readBool(snap['enabled'], DEFAULT_TAB_DORM_CONFIG.snapshots.enabled),
      intervalMinutes: clampNumber(snap['intervalMinutes'], DEFAULT_TAB_DORM_CONFIG.snapshots.intervalMinutes, b.intervalMinutes.min, b.intervalMinutes.max),
      maxSnapshotsRetained: clampNumber(snap['maxSnapshotsRetained'], DEFAULT_TAB_DORM_CONFIG.snapshots.maxSnapshotsRetained, b.maxSnapshotsRetained.min, b.maxSnapshotsRetained.max),
      retentionDays: clampNumber(snap['retentionDays'], DEFAULT_TAB_DORM_CONFIG.snapshots.retentionDays, b.retentionDays.min, b.retentionDays.max),
      autoBackupDownloadDays: clampNumber(snap['autoBackupDownloadDays'], DEFAULT_TAB_DORM_CONFIG.snapshots.autoBackupDownloadDays, b.autoBackupDownloadDays.min, b.autoBackupDownloadDays.max),
    },
  };
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
