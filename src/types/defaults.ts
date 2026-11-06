import {
  GROUP_ORDER_MODES,
  VALID_GROUP_COLORS,
  type AutoRouteRule,
  type CloseFocusMode,
  type GroupOrderMode,
  type TabDormConfig,
} from './config';

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
    stripSleepIcon: true,
    exemptions: {
      pinnedTabs: true,
      audibleTabs: true,
      activeInOtherWindows: true,
      urlPatterns: [],
      protectedGroupColors: [],
      protectedGroupTitles: [],
      unsavedForms: false,
      onBattery: false,
    },
  },
  groups: {
    suspendOnGroupCollapse: false,
    collapseOnSwitch: false,
    collapseOtherGroups: false,
    autoCollapseOnIdleMinutes: 0,
    orderOnActivate: 'bottom',
    routing: {
      enabled: true,
      reRouteAlreadyGrouped: false,
      autoGroupByDomain: true,
      minTabsPerGroup: 2,
      bucketLonelyTabs: false,
      rules: [],
    },
  },
  focus: {
    onActiveTabClosed: 'previous-other-group',
    historyDepth: 8,
    restoreSettleMs: 300,
  },
  stale: {
    staleAfterHours: 168,
  },
  images: {
    enabled: false,
    ttlMinutes: 1_440,
    maxMegabytes: 64,
    maxImageKilobytes: 0,
    minPixels: 4_096,
    minBytes: 8_192,
    autoCapture: true,
    sessionMaxImages: 200,
    sessionMaxMegabytes: 64,
    captureDeadlineMs: 1_500,
  },
  restoration: {
    batchSize: 10,
    delayBetweenTabsMs: 50,
    restoreAsDiscarded: true,
    restoreGroupsCollapsed: true,
    clampToBounds: true,
    nativeRestoreGuard: true,
    nativeRestoreGuardWindowMinutes: 30,
    nativeRestoreGuardMinTabs: 5,
    nativeRestoreGuardMatchPct: 80,
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
  minTabsPerGroup: { min: 1, max: 50 },
  idleThresholdMinutes: { min: 1, max: 10_080 },
  sweepIntervalMinutes: { min: 1, max: 1_440 },
  wakeCooldownMs: { min: 0, max: 3_600_000 },
  autoCollapseOnIdleMinutes: { min: 0, max: 10_080 },
  historyDepth: { min: 1, max: 25 },
  restoreSettleMs: { min: 0, max: 2_000 },
  batchSize: { min: 1, max: 100 },
  delayBetweenTabsMs: { min: 0, max: 5_000 },
  intervalMinutes: { min: 1, max: 1_440 },
  maxSnapshotsRetained: { min: 1, max: 10_000 },
  retentionDays: { min: 1, max: 3_650 },
  autoBackupDownloadDays: { min: 0, max: 365 },
  staleAfterHours: { min: 0, max: 8760 },
  imageTtlMinutes: { min: 15, max: 20_160 },
  imageMaxMegabytes: { min: 0, max: 8_192 },
  imageMaxImageKilobytes: { min: 0, max: 8_192 },
  imageMinPixels: { min: 0, max: 250_000 },
  imageMinBytes: { min: 0, max: 1_048_576 },
  imageSessionMaxImages: { min: 0, max: 5_000 },
  imageSessionMaxMegabytes: { min: 0, max: 8_192 },
  imageCaptureDeadlineMs: { min: 250, max: 5_000 },
  nativeRestoreGuardWindowMinutes: { min: 1, max: 10_080 },
  nativeRestoreGuardMinTabs: { min: 2, max: 500 },
  nativeRestoreGuardMatchPct: { min: 50, max: 100 },
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

const CLOSE_FOCUS_MODES: readonly CloseFocusMode[] = [
  'browser',
  'previous-tab',
  'previous-other-group',
];

function readGroupOrderMode(value: unknown): GroupOrderMode {
  return typeof value === 'string' && (GROUP_ORDER_MODES as readonly string[]).includes(value)
    ? (value as GroupOrderMode)
    : DEFAULT_TAB_DORM_CONFIG.groups.orderOnActivate;
}

function readCloseFocusMode(value: unknown): CloseFocusMode {
  return typeof value === 'string' && (CLOSE_FOCUS_MODES as readonly string[]).includes(value)
    ? (value as CloseFocusMode)
    : DEFAULT_TAB_DORM_CONFIG.focus.onActiveTabClosed;
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
  const g = readObject(source['groups']);
  const r = readObject(g['routing']);
  const focus = readObject(source['focus']);
  const st = readObject(source['stale']);
  const img = readObject(source['images']);
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
      stripSleepIcon: readBool(s['stripSleepIcon'], DEFAULT_TAB_DORM_CONFIG.suspension.stripSleepIcon),
      exemptions: {
        pinnedTabs: readBool(ex['pinnedTabs'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.pinnedTabs),
        audibleTabs: readBool(ex['audibleTabs'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.audibleTabs),
        activeInOtherWindows: readBool(ex['activeInOtherWindows'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.activeInOtherWindows),
        urlPatterns: readStringArray(ex['urlPatterns']),
        protectedGroupColors: Array.isArray(ex['protectedGroupColors'])
          ? ex['protectedGroupColors'].filter(isGroupColor)
          : [],
        protectedGroupTitles: readStringArray(ex['protectedGroupTitles']),
        unsavedForms: readBool(ex['unsavedForms'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.unsavedForms),
        onBattery: readBool(ex['onBattery'], DEFAULT_TAB_DORM_CONFIG.suspension.exemptions.onBattery),
      },
    },
    groups: {
      suspendOnGroupCollapse: readBool(g['suspendOnGroupCollapse'], DEFAULT_TAB_DORM_CONFIG.groups.suspendOnGroupCollapse),
      collapseOnSwitch: readBool(g['collapseOnSwitch'], DEFAULT_TAB_DORM_CONFIG.groups.collapseOnSwitch),
      collapseOtherGroups: readBool(g['collapseOtherGroups'], DEFAULT_TAB_DORM_CONFIG.groups.collapseOtherGroups),
      autoCollapseOnIdleMinutes: clampNumber(g['autoCollapseOnIdleMinutes'], DEFAULT_TAB_DORM_CONFIG.groups.autoCollapseOnIdleMinutes, b.autoCollapseOnIdleMinutes.min, b.autoCollapseOnIdleMinutes.max),
      orderOnActivate: readGroupOrderMode(g['orderOnActivate']),
      routing: {
        enabled: readBool(r['enabled'], DEFAULT_TAB_DORM_CONFIG.groups.routing.enabled),
        reRouteAlreadyGrouped: readBool(r['reRouteAlreadyGrouped'], DEFAULT_TAB_DORM_CONFIG.groups.routing.reRouteAlreadyGrouped),
        autoGroupByDomain: readBool(r['autoGroupByDomain'], DEFAULT_TAB_DORM_CONFIG.groups.routing.autoGroupByDomain),
        minTabsPerGroup: clampNumber(r['minTabsPerGroup'], DEFAULT_TAB_DORM_CONFIG.groups.routing.minTabsPerGroup, 1, 50),
        bucketLonelyTabs: readBool(r['bucketLonelyTabs'], DEFAULT_TAB_DORM_CONFIG.groups.routing.bucketLonelyTabs),
        rules: readRules(r['rules']),
      },
    },
    focus: {
      onActiveTabClosed: readCloseFocusMode(focus['onActiveTabClosed']),
      historyDepth: clampNumber(focus['historyDepth'], DEFAULT_TAB_DORM_CONFIG.focus.historyDepth, b.historyDepth.min, b.historyDepth.max),
      restoreSettleMs: clampNumber(focus['restoreSettleMs'], DEFAULT_TAB_DORM_CONFIG.focus.restoreSettleMs, b.restoreSettleMs.min, b.restoreSettleMs.max),
    },
    stale: {
      staleAfterHours: clampNumber(st['staleAfterHours'], DEFAULT_TAB_DORM_CONFIG.stale.staleAfterHours, b.staleAfterHours.min, b.staleAfterHours.max),
    },
    images: {
      enabled: readBool(img['enabled'], DEFAULT_TAB_DORM_CONFIG.images.enabled),
      ttlMinutes: clampNumber(img['ttlMinutes'], DEFAULT_TAB_DORM_CONFIG.images.ttlMinutes, b.imageTtlMinutes.min, b.imageTtlMinutes.max),
      maxMegabytes: clampNumber(img['maxMegabytes'], DEFAULT_TAB_DORM_CONFIG.images.maxMegabytes, b.imageMaxMegabytes.min, b.imageMaxMegabytes.max),
      maxImageKilobytes: clampNumber(img['maxImageKilobytes'], DEFAULT_TAB_DORM_CONFIG.images.maxImageKilobytes, b.imageMaxImageKilobytes.min, b.imageMaxImageKilobytes.max),
      minPixels: clampNumber(img['minPixels'], DEFAULT_TAB_DORM_CONFIG.images.minPixels, b.imageMinPixels.min, b.imageMinPixels.max),
      minBytes: clampNumber(img['minBytes'], DEFAULT_TAB_DORM_CONFIG.images.minBytes, b.imageMinBytes.min, b.imageMinBytes.max),
      autoCapture: readBool(img['autoCapture'], DEFAULT_TAB_DORM_CONFIG.images.autoCapture),
      sessionMaxImages: clampNumber(img['sessionMaxImages'], DEFAULT_TAB_DORM_CONFIG.images.sessionMaxImages, b.imageSessionMaxImages.min, b.imageSessionMaxImages.max),
      sessionMaxMegabytes: clampNumber(img['sessionMaxMegabytes'], DEFAULT_TAB_DORM_CONFIG.images.sessionMaxMegabytes, b.imageSessionMaxMegabytes.min, b.imageSessionMaxMegabytes.max),
      captureDeadlineMs: clampNumber(img['captureDeadlineMs'], DEFAULT_TAB_DORM_CONFIG.images.captureDeadlineMs, b.imageCaptureDeadlineMs.min, b.imageCaptureDeadlineMs.max),
    },
    restoration: {
      batchSize: clampNumber(rest['batchSize'], DEFAULT_TAB_DORM_CONFIG.restoration.batchSize, b.batchSize.min, b.batchSize.max),
      delayBetweenTabsMs: clampNumber(rest['delayBetweenTabsMs'], DEFAULT_TAB_DORM_CONFIG.restoration.delayBetweenTabsMs, b.delayBetweenTabsMs.min, b.delayBetweenTabsMs.max),
      restoreAsDiscarded: readBool(rest['restoreAsDiscarded'], DEFAULT_TAB_DORM_CONFIG.restoration.restoreAsDiscarded),
      restoreGroupsCollapsed: readBool(rest['restoreGroupsCollapsed'], DEFAULT_TAB_DORM_CONFIG.restoration.restoreGroupsCollapsed),
      clampToBounds: readBool(rest['clampToBounds'], DEFAULT_TAB_DORM_CONFIG.restoration.clampToBounds),
      nativeRestoreGuard: readBool(rest['nativeRestoreGuard'], DEFAULT_TAB_DORM_CONFIG.restoration.nativeRestoreGuard),
      nativeRestoreGuardWindowMinutes: clampNumber(rest['nativeRestoreGuardWindowMinutes'], DEFAULT_TAB_DORM_CONFIG.restoration.nativeRestoreGuardWindowMinutes, b.nativeRestoreGuardWindowMinutes.min, b.nativeRestoreGuardWindowMinutes.max),
      nativeRestoreGuardMinTabs: clampNumber(rest['nativeRestoreGuardMinTabs'], DEFAULT_TAB_DORM_CONFIG.restoration.nativeRestoreGuardMinTabs, b.nativeRestoreGuardMinTabs.min, b.nativeRestoreGuardMinTabs.max),
      nativeRestoreGuardMatchPct: clampNumber(rest['nativeRestoreGuardMatchPct'], DEFAULT_TAB_DORM_CONFIG.restoration.nativeRestoreGuardMatchPct, b.nativeRestoreGuardMatchPct.min, b.nativeRestoreGuardMatchPct.max),
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
