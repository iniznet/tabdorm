import { getConfig } from './config-store';
import {
  dropMru,
  isActiveClose,
  pickRestoreTarget,
  pushMru,
  stampGroup,
  type Activation,
  type MruEntry,
} from './close-focus';
import type { TabDormConfig } from '@/types';

/**
 * Focus restore on close.
 *
 * Chromium activates the neighbouring tab when you close the active one, which is
 * usually another member of the same tab group. This module keeps a per-window
 * activation history in chrome.storage.session and re-activates the tab you came
 * from, so closing a tab drops you back where you were rather than sideways.
 *
 * Two pure seams live in `close-focus.ts`: the history math and `pickRestoreTarget`.
 * Everything here is chrome glue.
 */

/** chrome.storage.session key: per-window activation history, most recent first. */
const HISTORY_KEY = 'tabdorm:activationHistory';

/** Chromium's "not in a group" id. */
const UNGROUPED = -1;

type HistoryMap = Record<string, MruEntry[]>;

interface PendingRestore {
  targetTabId: number;
  expiresAt: number;
}

/**
 * One intent per window: the tab we just chose, plus the grace window in which a
 * late browser-chosen activation is corrected once. Intents are keyed by window,
 * so the map can never grow past the window count.
 */
const pending = new Map<number, PendingRestore>();

/** Newest activation seen per window, with its timestamp. */
const lastActivation = new Map<number, Activation>();

/**
 * Serialized read-modify-write chain. Activations, group moves, and removals
 * arrive in bursts and chrome.storage.session offers no transactional update.
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

async function readHistory(): Promise<HistoryMap> {
  const stored = await chrome.storage.session.get(HISTORY_KEY);
  const raw = stored[HISTORY_KEY];
  if (typeof raw !== 'object' || raw === null) return {};
  const map: HistoryMap = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(value)) continue;
    const stack: MruEntry[] = [];
    for (const item of value) {
      if (typeof item !== 'object' || item === null) continue;
      const entry = item as Record<string, unknown>;
      if (typeof entry['tabId'] !== 'number') continue;
      stack.push({
        tabId: entry['tabId'],
        groupId: typeof entry['groupId'] === 'number' ? entry['groupId'] : UNGROUPED,
      });
    }
    if (stack.length > 0) map[key] = stack;
  }
  return map;
}

async function writeHistory(map: HistoryMap): Promise<void> {
  await chrome.storage.session.set({ [HISTORY_KEY]: map });
}

/**
 * Registers the activation-history listeners. MUST run synchronously inside
 * defineBackground(): a missed activation leaves the history lying about which
 * tab is active, and a missed removal skips the restore entirely.
 */
export function initCloseFocus(): void {
  chrome.tabs.onActivated.addListener((info) => {
    handleActivated({ tabId: info.tabId, windowId: info.windowId });
  });
  chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
    void handleRemoved(tabId, removeInfo);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    const groupId = changeInfo.groupId;
    if (groupId === undefined) return;
    void refreshGroup(tabId, groupId);
  });
  chrome.windows.onRemoved.addListener((windowId) => {
    pending.delete(windowId);
    lastActivation.delete(windowId);
    void forgetWindow(windowId);
  });
}

function handleActivated(info: { tabId: number; windowId: number }): void {
  lastActivation.set(info.windowId, { tabId: info.tabId, at: Date.now() });
  reassertPending(info);
  void serialize(async () => {
    const config = await getConfig();
    const tab = await chrome.tabs.get(info.tabId).catch(() => undefined);
    if (tab === undefined) return;
    const map = await readHistory();
    const key = String(info.windowId);
    map[key] = pushMru(
      map[key] ?? [],
      { tabId: info.tabId, groupId: tab.groupId },
      config.focus.historyDepth,
    );
    await writeHistory(map);
  });
}

/** A browser-chosen activation inside the grace window is corrected once. */
function reassertPending(info: { tabId: number; windowId: number }): void {
  const intent = pending.get(info.windowId);
  if (intent === undefined) return;
  if (info.tabId === intent.targetTabId) return;
  pending.delete(info.windowId);
  if (Date.now() > intent.expiresAt) return;
  void chrome.tabs.update(intent.targetTabId, { active: true }).catch(() => undefined);
}

/**
 * Removal is the only place the restore may fire. The whole bookkeeping block is
 * serialized so a concurrent activation cannot splice a stale stack under us.
 */
async function handleRemoved(tabId: number, removeInfo: chrome.tabs.OnRemovedInfo): Promise<void> {
  const config = await getConfig();
  await serialize(async () => {
    const key = String(removeInfo.windowId);
    const map = await readHistory();
    const stack = map[key] ?? [];
    const closedEntry = stack.find((item) => item.tabId === tabId);
    const remaining = dropMru(stack, tabId);
    if (remaining.length === 0) delete map[key];
    else map[key] = remaining;
    await writeHistory(map);
    if (removeInfo.isWindowClosing) return;
    const latest = lastActivation.get(removeInfo.windowId);
    if (!isActiveClose(stack, tabId, latest, Date.now(), config.focus.restoreSettleMs)) return;
    await restoreFocus(removeInfo.windowId, remaining, closedEntry, config);
  });
}

async function restoreFocus(
  windowId: number,
  stack: readonly MruEntry[],
  closedEntry: MruEntry | undefined,
  config: TabDormConfig,
): Promise<void> {
  if (config.focus.onActiveTabClosed === 'browser') return;
  const live = await chrome.tabs.query({ windowId }).catch(() => [] as chrome.tabs.Tab[]);
  const alive = new Set<number>();
  for (const tab of live) {
    if (tab.id !== undefined) alive.add(tab.id);
  }
  const candidates = stack.filter((entry) => alive.has(entry.tabId));
  const target = pickRestoreTarget(
    candidates,
    closedEntry?.groupId ?? null,
    config.focus.onActiveTabClosed,
  );
  if (target === null) return;
  const current = live.find((tab) => tab.active);
  if (current?.id === target) return;
  pending.set(windowId, { targetTabId: target, expiresAt: Date.now() + config.focus.restoreSettleMs });
  try {
    await chrome.tabs.update(target, { active: true });
  } catch {
    pending.delete(windowId);
  }
}

function refreshGroup(tabId: number, groupId: number): Promise<void> {
  return serialize(async () => {
    const map = await readHistory();
    let touched = false;
    for (const [key, stack] of Object.entries(map)) {
      if (!stack.some((entry) => entry.tabId === tabId)) continue;
      map[key] = stampGroup(stack, tabId, groupId);
      touched = true;
    }
    if (touched) await writeHistory(map);
  });
}

function forgetWindow(windowId: number): Promise<void> {
  return serialize(async () => {
    const map = await readHistory();
    if (map[String(windowId)] === undefined) return;
    delete map[String(windowId)];
    await writeHistory(map);
  });
}
