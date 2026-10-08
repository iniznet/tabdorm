import type { GroupColor, StoredGroup, StoredTab, StoredWindow, UnifiedSession, WindowState } from '@/types';
import { getConfig } from './config-store';
import { putSession } from './db';
import { contentHashOf } from './hash';
import { isSavableWindow, safeTabUrl, stripSensitiveParams } from './sanitize';

/** Contextually-typed onUpdated callback args (changeInfo is chrome.tabs.OnUpdatedInfo). */
type TabsOnUpdatedArgs = Parameters<Parameters<typeof chrome.tabs.onUpdated.addListener>[0]>;

interface ShadowTab {
  tabId: number;
  index: number;
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  discarded: boolean;
  groupId?: number;
}

interface ShadowGroup {
  groupId: number;
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

interface ShadowWindow {
  windowId: number;
  state: WindowState;
  incognito: boolean;
  type: string;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  tabs: Map<number, ShadowTab>;
  groups: Map<number, ShadowGroup>;
}

/**
 * Live in-memory mirror of open tabs, groups, and window states.
 *
 * Why: chrome.windows.onRemoved fires AFTER Chrome has destroyed the tab and
 * group objects, so a closed window can only be captured from shadow state.
 * Listeners are installed synchronously (MV3 cold-start requirement) and the
 * tree hydrates lazily from live Chrome APIs on first access after a worker
 * restart.
 */
export class ShadowTree {
  #windows = new Map<number, ShadowWindow>();
  #hydrated = false;

  async init(): Promise<void> {
    await this.#ensureHydrated();
  }

  /** Registers all event listeners synchronously. Call exactly once at startup. */
  install(): void {
    chrome.tabs.onCreated.addListener((tab) => {
      void this.#onTabCreated(tab);
    });
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      this.#onTabUpdated(tabId, changeInfo, tab);
    });
    // (tabGroups.onUpdated receives only the group — no changeInfo — in @types/chrome 0.3.x)
    chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
      void this.#onTabRemoved(tabId, removeInfo.windowId);
    });
    chrome.tabs.onMoved.addListener((_tabId, moveInfo) => {
      void this.#syncWindow(moveInfo.windowId);
    });
    chrome.tabs.onAttached.addListener((_tabId, attachInfo) => {
      void this.#syncWindow(attachInfo.newWindowId);
    });
    chrome.tabs.onDetached.addListener((_tabId, detachInfo) => {
      void this.#syncWindow(detachInfo.oldWindowId);
    });
    chrome.tabs.onReplaced.addListener((addedTabId, oldTabId) => {
      this.#onTabReplaced(addedTabId, oldTabId);
    });
    chrome.tabGroups.onCreated.addListener((group) => {
      this.#onGroupCreated(group);
    });
    chrome.tabGroups.onUpdated.addListener((group) => {
      this.#onGroupUpdated(group);
    });
    chrome.tabGroups.onRemoved.addListener((group) => {
      this.#onGroupRemoved(group);
    });
    chrome.windows.onCreated.addListener((win) => {
      void this.#onWindowCreated(win);
    });
    chrome.windows.onRemoved.addListener((windowId) => {
      void this.#onWindowRemoved(windowId);
    });
  }

  /** Snapshot of every currently-savable window (manual snapshots, exports). */
  snapshotAll(): StoredWindow[] {
    const out: StoredWindow[] = [];
    for (const win of this.#windows.values()) {
      const stored = this.#storedWindowFrom(win);
      if (stored !== null) out.push(stored);
    }
    return out;
  }

  async #ensureHydrated(): Promise<void> {
    if (this.#hydrated) return;
    this.#hydrated = true;
    const [wins, groups] = await Promise.all([
      chrome.windows.getAll({ populate: true }),
      chrome.tabGroups.query({}),
    ]);
    const byId = new Map<number, ShadowWindow>();
    for (const win of wins) {
      if (win.id === undefined) continue;
      const shadow = this.#shadowWindowFromChrome(win, false);
      byId.set(win.id, shadow);
      this.#windows.set(win.id, shadow);
    }
    for (const group of groups) {
      byId.get(group.windowId)?.groups.set(group.id, this.#shadowGroupFromChrome(group));
    }
    for (const win of wins) {
      const shadow = win.id === undefined ? undefined : byId.get(win.id);
      if (shadow === undefined || win.tabs === undefined) continue;
      for (const tab of win.tabs) shadow.tabs.set(tab.id ?? -1, this.#shadowTabFromChrome(tab));
    }
  }

  async #onTabCreated(tab: chrome.tabs.Tab): Promise<void> {
    await this.#ensureHydrated();
    if (tab.windowId === undefined || tab.windowId === chrome.windows.WINDOW_ID_NONE) return;
    await this.#syncWindow(tab.windowId);
  }

  #onTabUpdated(tabId: TabsOnUpdatedArgs[0], changeInfo: TabsOnUpdatedArgs[1], tab: TabsOnUpdatedArgs[2]): void {
    const shadow = this.#windows.get(tab.windowId)?.tabs.get(tabId);
    if (shadow === undefined) {
      void this.#syncWindow(tab.windowId);
      return;
    }
    if (changeInfo.url !== undefined) shadow.url = changeInfo.url;
    if (changeInfo.title !== undefined) shadow.title = changeInfo.title;
    if (changeInfo.favIconUrl !== undefined) shadow.favIconUrl = changeInfo.favIconUrl;
    if (changeInfo.pinned !== undefined) shadow.pinned = changeInfo.pinned;
    if (changeInfo.status !== undefined && changeInfo.status === 'complete') shadow.discarded = false;
  }

  async #onTabRemoved(tabId: number, windowId: number): Promise<void> {
    await this.#ensureHydrated();
    const win = this.#windows.get(windowId);
    if (win !== undefined) win.tabs.delete(tabId);
  }

  #onTabReplaced(addedTabId: number, oldTabId: number): void {
    for (const win of this.#windows.values()) {
      const old = win.tabs.get(oldTabId);
      if (old === undefined) continue;
      win.tabs.delete(oldTabId);
      win.tabs.set(addedTabId, { ...old, tabId: addedTabId });
      return;
    }
  }

  #onGroupCreated(group: chrome.tabGroups.TabGroup): void {
    this.#windows.get(group.windowId)?.groups.set(group.id, this.#shadowGroupFromChrome(group));
  }

  #onGroupUpdated(group: chrome.tabGroups.TabGroup): void {
    const shadow = this.#windows.get(group.windowId)?.groups.get(group.id);
    if (shadow === undefined) return;
    if (group.title !== undefined) shadow.title = group.title;
    shadow.color = group.color;
    shadow.collapsed = group.collapsed;
  }

  #onGroupRemoved(group: chrome.tabGroups.TabGroup): void {
    this.#windows.get(group.windowId)?.groups.delete(group.id);
  }

  async #onWindowCreated(win: chrome.windows.Window): Promise<void> {
    await this.#ensureHydrated();
    if (win.id === undefined) return;
    const shadow = this.#shadowWindowFromChrome(win, false);
    this.#windows.set(win.id, shadow);
    await this.#syncWindow(win.id);
  }

  /**
   * Closed Window Shadow Tree capture: by the time this fires the real tab
   * objects are gone, so the snapshot is rebuilt purely from shadow state.
   */
  async #onWindowRemoved(windowId: number): Promise<void> {
    await this.#ensureHydrated();
    const win = this.#windows.get(windowId);
    this.#windows.delete(windowId);
    if (win === undefined) return;
    const stored = this.#storedWindowFrom(win);
    if (stored === null) return;
    const config = await getConfig();
    if (!config.snapshots.enabled) return;
    const session: UnifiedSession = {
      id: crypto.randomUUID(),
      name: `Closed window — ${new Date().toLocaleString()}`,
      timestamp: Date.now(),
      type: 'closed_window',
      contentHash: contentHashOf([stored]),
      windows: [stored],
    };
    try {
      await putSession(session);
    } catch (error) {
      console.warn('[tabdorm] failed to persist closed-window snapshot.', error);
    }
  }

  async #syncWindow(windowId: number): Promise<void> {
    await this.#ensureHydrated();
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    const tabs = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
    if (tabs.length === 0) {
      this.#windows.delete(windowId);
      return;
    }
    let win = this.#windows.get(windowId);
    if (win === undefined) {
      try {
        win = this.#shadowWindowFromChrome(await chrome.windows.get(windowId), false);
      } catch {
        return;
      }
      this.#windows.set(windowId, win);
    }
    const next = new Map<number, ShadowTab>();
    for (const tab of tabs) next.set(tab.id ?? -1, this.#shadowTabFromChrome(tab));
    win.tabs = next;
  }

  #shadowWindowFromChrome(win: chrome.windows.Window, withTabs: boolean): ShadowWindow {
    const shadow: ShadowWindow = {
      windowId: win.id ?? chrome.windows.WINDOW_ID_NONE,
      state: win.state ?? 'normal',
      incognito: win.incognito === true,
      type: win.type ?? 'normal',
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
      tabs: new Map(),
      groups: new Map(),
    };
    if (withTabs && win.tabs !== undefined) {
      for (const tab of win.tabs) shadow.tabs.set(tab.id ?? -1, this.#shadowTabFromChrome(tab));
    }
    return shadow;
  }

  #shadowTabFromChrome(tab: chrome.tabs.Tab): ShadowTab {
    return {
      tabId: tab.id ?? -1,
      index: tab.index,
      url: safeTabUrl(tab),
      title: tab.title ?? '',
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned === true,
      discarded: tab.discarded === true,
      groupId: tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE ? tab.groupId : undefined,
    };
  }

  #shadowGroupFromChrome(group: chrome.tabGroups.TabGroup): ShadowGroup {
    return {
      groupId: group.id,
      title: group.title ?? '',
      color: group.color ?? 'grey',
      collapsed: group.collapsed === true,
    };
  }

  #storedWindowFrom(win: ShadowWindow): StoredWindow | null {
    if (!isSavableWindow(win)) return null;
    const tabs = [...win.tabs.values()].sort((a, b) => a.index - b.index);
    if (tabs.length === 0) return null;
    const groupKeys = new Map<number, string>();
    const groups: StoredGroup[] = [...win.groups.values()].map((group) => {
      const key = crypto.randomUUID();
      groupKeys.set(group.groupId, key);
      return { key, title: group.title, color: group.color, collapsed: group.collapsed };
    });
    const storedTabs: StoredTab[] = tabs.map((tab) => ({
      url: stripSensitiveParams(tab.url),
      title: tab.title,
      favIconUrl: tab.favIconUrl,
      pinned: tab.pinned,
      isDiscarded: tab.discarded,
      groupKey: tab.groupId !== undefined ? groupKeys.get(tab.groupId) : undefined,
    }));
    return {
      state: win.state,
      left: win.left,
      top: win.top,
      width: win.width,
      height: win.height,
      groups,
      tabs: storedTabs,
    };
  }
}
