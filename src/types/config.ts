import type { GroupColor } from './session';

/** User-configurable tab-sorting rule evaluated against committed top-frame URLs. */
export interface AutoRouteRule {
  id: string;
  enabled: boolean;
  /** Match-pattern-lite wildcard (e.g. "*.github.com/*") or "regexp:<source>" for raw regex. */
  pattern: string;
  groupTitle: string;
  groupColor: GroupColor;
  autoCollapse?: boolean;
}

/** Fully-typed configuration. Every timer, threshold, and rule lives here — zero hardcoding. */
export interface TabDormConfig {
  schemaVersion: number;
  suspension: {
    enabled: boolean;
    idleThresholdMinutes: number;
    sweepIntervalMinutes: number;
    memorySaverPolicy: 'cooperative' | 'exclusive' | 'custom_shield';
    /** Cooldown after waking from system sleep before any suspension may run. */
    wakeCooldownMs: number;
    exemptions: {
      pinnedTabs: boolean;
      audibleTabs: boolean;
      activeInOtherWindows: boolean;
      urlPatterns: string[];
      protectedGroupColors: GroupColor[];
      protectedGroupTitles: string[];
    };
  };
  groups: {
    suspendOnGroupCollapse: boolean;
    autoCollapseOnIdleMinutes: number;
    routing: {
      enabled: boolean;
      reRouteAlreadyGrouped: boolean;
      rules: AutoRouteRule[];
    };
  };
  restoration: {
    batchSize: number;
    delayBetweenTabsMs: number;
    restoreAsDiscarded: boolean;
    restoreGroupsCollapsed: boolean;
    clampToBounds: boolean;
  };
  snapshots: {
    enabled: boolean;
    intervalMinutes: number;
    maxSnapshotsRetained: number;
    retentionDays: number;
    autoBackupDownloadDays: number;
  };
}

export const VALID_GROUP_COLORS: readonly GroupColor[] = [
  'grey',
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
] as const;
