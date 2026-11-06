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

/**
 * Where a group moves when you activate one of its tabs: nowhere, to the top of the
 * strip, or to the bottom. Keeps the group you are working in at one end.
 */
export type GroupOrderMode = 'off' | 'top' | 'bottom';

/** Whitelist for {@link GroupOrderMode}. An unknown stored value resolves to 'bottom'. */
export const GROUP_ORDER_MODES: readonly GroupOrderMode[] = ['off', 'top', 'bottom'];

/**
 * Pinned image cache for suspended tabs: the images a tab was showing, kept
 * locally so a wake paints them without the network.
 *
 * Off by default. Capturing needs the optional `scripting` + `<all_urls>` grant,
 * and a fresh install holds neither, so defaulting on would surprise the user
 * with a permission prompt and disk writes.
 */
export interface ImageCacheConfig {
  enabled: boolean;
  /** How long a captured image may be served; measured from capture time. */
  ttlMinutes: number;
  /** Byte budget for the whole store; least recently used entries go first. `0` means no cap. */
  maxMegabytes: number;
  /** One image larger than this is skipped entirely. */
  maxImageKilobytes: number;
  /** Images below this pixel area are skipped — tracking pixels, spacers, icons. */
  minPixels: number;
  /** Wall-clock ceiling for one tab's capture, so a suspend never waits on it. */
  captureDeadlineMs: number;
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
    /**
     * Paint a dim z over the page favicon before discarding, so Chrome's own tab
     * strip shows the sleep state. Needs the optional scripting grant; without it
     * the mark is skipped and suspension behaves exactly as before.
     */
    stripSleepIcon: boolean;
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
    /** Fold every expanded group except the one you land in. */
    collapseOtherGroups: boolean;
    autoCollapseOnIdleMinutes: number;
    /** Move the activated group to one end of the strip. */
    orderOnActivate: GroupOrderMode;
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
  stale: {
    /** Hours without a visit before a tab is flagged stale; 0 disables flagging. */
    staleAfterHours: number;
  };
  images: ImageCacheConfig;
  restoration: {
    batchSize: number;
    delayBetweenTabsMs: number;
    restoreAsDiscarded: boolean;
    restoreGroupsCollapsed: boolean;
    clampToBounds: boolean;
    /** Re-discard tabs that were asleep at close time after Chrome's native Ctrl+Shift+T window restore. */
    nativeRestoreGuard: boolean;
    /** A closed_window snapshot older than this never matches a newly opened window. */
    nativeRestoreGuardWindowMinutes: number;
    /** A window with fewer than this many tabs is never guard-matched. */
    nativeRestoreGuardMinTabs: number;
    /** Positional URL-match percentage required to treat a new window as a native restore. */
    nativeRestoreGuardMatchPct: number;
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
