import type { StoredWindow, TabDormConfig } from '@/types';
import { getConfig } from './config-store';
import { getSession } from './db';
import { scheduleDiscardOnCommit } from './discard';

/** Screen metrics supplied by a DOM context (panel/popup); the service worker has none. */
export interface Viewport {
  availWidth: number;
  availHeight: number;
}

export interface WindowGeometry {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
}

/**
 * Geometry Clamping: keeps a restored window inside the visible work area so
 * it never opens off-screen on a smaller monitor than the one it was saved on.
 * Left/top are clamped against availWidth/availHeight; width/height are clamped
 * so the window can never exceed the work area. Missing values stay missing.
 */
export function clampGeometry(win: WindowGeometry, viewport: Viewport): WindowGeometry {
  const width = win.width === undefined ? undefined : Math.max(1, Math.min(win.width, viewport.availWidth));
  const height = win.height === undefined ? undefined : Math.max(1, Math.min(win.height, viewport.availHeight));
  const effectiveWidth = width ?? viewport.availWidth;
  const effectiveHeight = height ?? viewport.availHeight;
  const left = win.left === undefined ? undefined : Math.min(Math.max(win.left, 0), Math.max(0, viewport.availWidth - effectiveWidth));
  const top = win.top === undefined ? undefined : Math.min(Math.max(win.top, 0), Math.max(0, viewport.availHeight - effectiveHeight));
  return { left, top, width, height };
}

export interface RestoreProgress {
  windowsRestored: number;
  tabsCreated: number;
  tabsFailed: number;
  groupsRestored: number;
}

export interface RestoreOutcome {
  ok: boolean;
  progress?: RestoreProgress;
  error?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface CreatedTab {
  tabId: number;
  groupKey?: string;
}

/**
 * Restoration Pipeline (zero-CPU lockup):
 * 1. Opens the window with its active tab focused for instant visual feedback.
 * 2. Streams background tabs SEQUENTIALLY — never Promise.all — pausing
 *    delayBetweenTabsMs between creates (batchSize chunks bound the loop).
 * 3. restoreAsDiscarded flags each new tab through the Discard Race Guard so
 *    background tabs are discarded right after their commit, not during parse.
 * 4. Rebuilds groups from contiguous index-order slices — Chromium requires
 *    group members to be physically contiguous — one atomic tabs.group per slice.
 */
export async function restoreSession(sessionId: string, viewport?: Viewport): Promise<RestoreProgress> {
  const session = await getSession(sessionId);
  if (session === undefined) throw new Error(`Session ${sessionId} not found.`);
  const config = await getConfig();
  const progress: RestoreProgress = { windowsRestored: 0, tabsCreated: 0, tabsFailed: 0, groupsRestored: 0 };
  for (const win of session.windows) {
    if (win.tabs.length === 0) continue;
    await restoreWindow(win, config, viewport, progress);
  }
  return progress;
}

async function restoreWindow(
  win: StoredWindow,
  config: TabDormConfig,
  viewport: Viewport | undefined,
  progress: RestoreProgress,
): Promise<void> {
  const rest = config.restoration;
  const geometry =
    rest.clampToBounds && viewport !== undefined
      ? clampGeometry(win, viewport)
      : { left: win.left, top: win.top, width: win.width, height: win.height };
  const maximized = win.state === 'maximized' || win.state === 'fullscreen';

  const first = win.tabs[0];
  if (first === undefined) return;
  const backgroundTabs = win.tabs.slice(1);
  let newWindow: chrome.windows.Window | undefined;
  try {
    newWindow = await chrome.windows.create({
      url: first.url,
      focused: true,
      ...(maximized ? { state: win.state } : geometry),
    });
  } catch (error) {
    console.warn('[tabdorm] window restore failed.', error);
    progress.tabsFailed += win.tabs.length;
    return;
  }
  if (newWindow === undefined || newWindow.id === undefined || newWindow.tabs === undefined || newWindow.tabs[0] === undefined) {
    progress.tabsFailed += win.tabs.length;
    return;
  }
  progress.windowsRestored += 1;

  const created: CreatedTab[] = [];
  const firstTabId = newWindow.tabs[0].id ?? -1;
  if (first.pinned && firstTabId !== -1) {
    await chrome.tabs.update(firstTabId, { pinned: true }).catch(() => undefined);
  }
  created.push({ tabId: firstTabId, groupKey: first.groupKey });
  if (rest.restoreAsDiscarded) scheduleDiscardOnCommit(firstTabId);
  progress.tabsCreated += 1;

  let index = 1;
  for (const tab of backgroundTabs) {
    try {
      const createdTab = await chrome.tabs.create({
        windowId: newWindow.id,
        url: tab.url,
        index,
        pinned: tab.pinned,
        active: false,
      });
      created.push({ tabId: createdTab.id ?? -1, groupKey: tab.groupKey });
      if (rest.restoreAsDiscarded) scheduleDiscardOnCommit(createdTab.id ?? -1);
      progress.tabsCreated += 1;
    } catch {
      progress.tabsFailed += 1;
    }
    index += 1;
    if (rest.delayBetweenTabsMs > 0) await sleep(rest.delayBetweenTabsMs);
  }

  if (win.groups.length > 0) {
    await groupContiguousSlices(created, newWindow.id, win, rest.restoreGroupsCollapsed, progress);
  }
}

/**
 * Contiguity Rule: walks the created tabs in strict index order and issues one
 * atomic chrome.tabs.group() per maximal run sharing a groupKey. Pinned tabs
 * never join groups (Chromium mutual exclusion), so runs skip them.
 */
async function groupContiguousSlices(
  created: readonly CreatedTab[],
  windowId: number,
  win: StoredWindow,
  collapsed: boolean,
  progress: RestoreProgress,
): Promise<void> {
  let currentKey: string | undefined;
  let run: number[] = [];
  const flush = async (): Promise<void> => {
    if (currentKey === undefined || run.length === 0) return;
    const meta = win.groups.find((g) => g.key === currentKey);
    if (meta === undefined) return;
    // chrome.tabs.group requires a non-empty tuple; flush() guarantees run.length >= 1.
    const head = run.at(0);
    if (head === undefined) return;
    const tabIds: [number, ...number[]] = [head, ...run.slice(1)];
    try {
      const groupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
      await chrome.tabGroups.update(groupId, {
        title: meta.title,
        color: meta.color,
        collapsed: collapsed || meta.collapsed,
      });
      progress.groupsRestored += 1;
    } catch (error) {
      if (!/Tabs cannot be edited right now/i.test(error instanceof Error ? error.message : String(error))) {
        console.warn('[tabdorm] group restore failed for slice.', error);
      }
    }
    run = [];
  };
  for (const tab of created) {
    if (tab.tabId === -1) continue;
    if (tab.groupKey !== undefined && tab.groupKey === currentKey) {
      run.push(tab.tabId);
      continue;
    }
    await flush();
    currentKey = tab.groupKey;
    if (tab.groupKey !== undefined) run = [tab.tabId];
  }
  await flush();
}
