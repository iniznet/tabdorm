import { contentHashOf } from './hash';
import type { StoredGroup, StoredTab, StoredWindow, UnifiedSession } from '@/types';

const WINDOW_STATES: readonly string[] = ['normal', 'minimized', 'maximized', 'fullscreen', 'locked-fullscreen'];

/** Validates untrusted imported JSON and rebuilds it as a fresh user_saved session. */
export function parseImportedSession(text: string): UnifiedSession {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('File is not valid JSON.');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Not a TabDorm session file.');
  }
  const source = raw as { name?: unknown; windows?: unknown };
  if (!Array.isArray(source.windows) || source.windows.length === 0) {
    throw new Error('File contains no windows.');
  }
  const windows = source.windows.map(parseWindow);
  const baseName = typeof source.name === 'string' && source.name.trim() !== '' ? source.name.trim() : 'Imported session';
  return {
    id: crypto.randomUUID(),
    name: baseName + ' (imported)',
    timestamp: Date.now(),
    type: 'user_saved',
    contentHash: contentHashOf(windows),
    windows,
  };
}

function parseWindow(raw: unknown): StoredWindow {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Malformed window entry.');
  }
  const w = raw as {
    state?: unknown;
    left?: unknown;
    top?: unknown;
    width?: unknown;
    height?: unknown;
    groups?: unknown;
    tabs?: unknown;
  };
  if (!Array.isArray(w.tabs)) throw new Error('Window is missing its tab list.');
  return {
    state: typeof w.state === 'string' && WINDOW_STATES.includes(w.state) ? (w.state as StoredWindow['state']) : 'normal',
    left: typeof w.left === 'number' ? w.left : undefined,
    top: typeof w.top === 'number' ? w.top : undefined,
    width: typeof w.width === 'number' ? w.width : undefined,
    height: typeof w.height === 'number' ? w.height : undefined,
    groups: Array.isArray(w.groups) ? (w.groups.filter(isStoredGroup) as StoredGroup[]) : [],
    tabs: w.tabs.map(parseTab),
  };
}

function isStoredGroup(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null) return false;
  const g = raw as { key?: unknown; title?: unknown; color?: unknown };
  return typeof g.key === 'string' && typeof g.title === 'string' && typeof g.color === 'string';
}

function parseTab(raw: unknown): StoredTab {
  if (typeof raw !== 'object' || raw === null) throw new Error('Malformed tab entry.');
  const t = raw as {
    url?: unknown;
    title?: unknown;
    favIconUrl?: unknown;
    pinned?: unknown;
    isDiscarded?: unknown;
    groupKey?: unknown;
  };
  if (typeof t.url !== 'string' || t.url === '' || typeof t.title !== 'string') {
    throw new Error('Tab entry is missing a URL or title.');
  }
  return {
    url: t.url,
    title: t.title,
    ...(typeof t.favIconUrl === 'string' ? { favIconUrl: t.favIconUrl } : {}),
    pinned: t.pinned === true,
    isDiscarded: t.isDiscarded === true,
    ...(typeof t.groupKey === 'string' ? { groupKey: t.groupKey } : {}),
  };
}
