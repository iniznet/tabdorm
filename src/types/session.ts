/** Chromium contract: groupId sentinel for "not in a group". */
export const TAB_GROUP_ID_NONE = -1;

/** Native Chromium tab-group colors (@types/chrome global namespace). */
export type GroupColor = `${chrome.tabGroups.Color}`;

/** Native Chromium window states. */
export type WindowState = `${chrome.windows.WindowState}`;

/** Serializable snapshot of a single tab (survives tab-object death). */
export interface StoredTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  isDiscarded: boolean;
  /** Synthetic UUID linking this tab to a StoredGroup; absent when ungrouped. */
  groupKey?: string;
}

/** Serializable snapshot of a tab group. Keyed by synthetic UUID, never by title. */
export interface StoredGroup {
  key: string;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

/** Serializable snapshot of a browser window with its tabs in index order. */
export interface StoredWindow {
  state: WindowState;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  groups: StoredGroup[];
  /** Ordered by original tab index (0..N) — the contiguity contract for restoration. */
  tabs: StoredTab[];
}

export type SessionType = 'auto_snapshot' | 'user_saved' | 'closed_window';

/** Unified session record persisted to IndexedDB via Dexie. */
export interface UnifiedSession {
  id: string;
  name: string;
  timestamp: number;
  type: SessionType;
  /** Structural hash used to skip identical auto-snapshots. */
  contentHash: string;
  windows: StoredWindow[];
}
