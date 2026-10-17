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

/**
 * How the close of the active tab is handled: Chromium's neighbouring tab, or a
 * tab from the window's activation history (optionally restricted to another group).
 */
export type CloseFocusMode = 'browser' | 'previous-tab' | 'previous-other-group';

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
      /** Opt-in: never suspend a tab with unsaved form input (draft protection). */
      unsavedForms: boolean;
      /** Opt-in: never suspend while the machine is running on battery. */
      onBattery: boolean;
    };
  };
  groups: {
    suspendOnGroupCollapse: boolean;
    collapseOnSwitch: boolean;
    autoCollapseOnIdleMinutes: number;
    routing: {
      enabled: boolean;
      reRouteAlreadyGrouped: boolean;
      /** Zero-config fallback: group tabs by site when no rule matches. */
      autoGroupByDomain: boolean;
      /** A site only earns a group when at least this many tabs share a window (rules bypass this). */
      minTabsPerGroup: number;
      /** Collect below-threshold sites into one grey bucket group. */
      bucketLonelyTabs: boolean;
      rules: AutoRouteRule[];
    };
  };
  focus: {
    /** Which tab becomes active when the tab you are looking at is closed. */
    onActiveTabClosed: CloseFocusMode;
    /** Per-window activation-history depth the restore may walk back through. */
    historyDepth: number;
    /** Grace window (ms) for correcting a late browser-chosen activation; 0 disables it. */
    restoreSettleMs: number;
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
