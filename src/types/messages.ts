/** Requests the UI surfaces may send to the background service worker. */
export type RestoreDestination = 'original' | 'single' | 'current';

/** Identifies one tab inside a UnifiedSession by its position. */
export interface RestoreSelectionEntry {
  windowIndex: number;
  tabIndex: number;
}

export type BackgroundRequest =
  | { type: 'snapshotNow' }
  | { type: 'runSweep' }
  | { type: 'suspendTab'; tabId: number }
  | { type: 'restoreSession'; sessionId: string; screen: { availWidth: number; availHeight: number }; destination?: RestoreDestination; selection?: RestoreSelectionEntry[] }
  | { type: 'migrateTms' }
  | { type: 'openUrlList'; urls: string[] }
  | { type: 'reportBattery'; charging: boolean }
  | { type: 'closeDuplicates'; tabIds: number[] }
  | { type: 'dirtyForm' }
  | { type: 'clearDirtyForm' };

export type BackgroundResponse =
  | { ok: true; payload?: unknown }
  | { ok: false; error: string };

export type RequestType = BackgroundRequest['type'];

const REQUEST_TYPES: readonly RequestType[] = [
  'snapshotNow',
  'runSweep',
  'suspendTab',
  'restoreSession',
  'migrateTms',
  'openUrlList',
  'reportBattery',
  'closeDuplicates',
  'dirtyForm',
  'clearDirtyForm',
];

const RESTORE_DESTINATIONS: readonly RestoreDestination[] = ['original', 'single', 'current'];

/**
 * Runtime validation for messages crossing the extension boundary — zero blind
 * casting of external data (Zero-Trust ingress rule).
 */
export function parseBackgroundRequest(raw: unknown): { ok: true; request: BackgroundRequest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Request must be an object.' };
  const candidate = raw as Record<string, unknown>;
  const type = candidate['type'];
  if (typeof type !== 'string' || !(REQUEST_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `Unknown request type: ${String(type)}` };
  }
  switch (type) {
    case 'snapshotNow':
    case 'runSweep':
    case 'migrateTms':
    case 'dirtyForm':
    case 'clearDirtyForm':
      return { ok: true, request: { type } };
    case 'suspendTab': {
      const tabId = candidate['tabId'];
      if (typeof tabId !== 'number' || !Number.isInteger(tabId)) return { ok: false, error: 'suspendTab requires an integer tabId.' };
      return { ok: true, request: { type, tabId } };
    }
    case 'closeDuplicates': {
      const tabIds = candidate['tabIds'];
      if (
        !Array.isArray(tabIds) ||
        tabIds.length === 0 ||
        tabIds.length > 500 ||
        tabIds.some((t) => typeof t !== 'number' || !Number.isInteger(t) || t <= 0)
      ) {
        return { ok: false, error: 'closeDuplicates requires a non-empty array of positive integer tab ids (max 500).' };
      }
      return { ok: true, request: { type, tabIds: tabIds as number[] } };
    }
    case 'reportBattery': {
      const charging = candidate['charging'];
      if (typeof charging !== 'boolean') return { ok: false, error: 'reportBattery requires a boolean charging state.' };
      return { ok: true, request: { type, charging } };
    }
    case 'openUrlList': {
      const urls = candidate['urls'];
      if (!Array.isArray(urls) || urls.length === 0 || urls.some((u) => typeof u !== 'string')) {
        return { ok: false, error: 'openUrlList requires a non-empty array of URL strings.' };
      }
      return { ok: true, request: { type, urls: urls as string[] } };
    }
    case 'restoreSession': {
      const sessionId = candidate['sessionId'];
      const screen = candidate['screen'];
      const availWidth = typeof screen === 'object' && screen !== null ? (screen as Record<string, unknown>)['availWidth'] : undefined;
      const availHeight = typeof screen === 'object' && screen !== null ? (screen as Record<string, unknown>)['availHeight'] : undefined;
      if (typeof sessionId !== 'string' || sessionId === '') return { ok: false, error: 'restoreSession requires a sessionId.' };
      if (typeof availWidth !== 'number' || typeof availHeight !== 'number') {
        return { ok: false, error: 'restoreSession requires screen metrics for geometry clamping.' };
      }
      const destination = candidate['destination'];
      if (destination !== undefined && !(RESTORE_DESTINATIONS as readonly string[]).includes(destination as RestoreDestination)) {
        return { ok: false, error: `Invalid restore destination: ${String(destination)}` };
      }
      const selection = candidate['selection'];
      if (selection !== undefined && !isValidSelection(selection)) {
        return { ok: false, error: 'selection must be an array of {windowIndex, tabIndex} integers.' };
      }
      return {
        ok: true,
        request: {
          type,
          sessionId,
          screen: { availWidth, availHeight },
          destination: destination as RestoreDestination | undefined,
          selection: selection as RestoreSelectionEntry[] | undefined,
        },
      };
    }
  }
  throw new Error('unreachable request type');
}

function isValidSelection(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.every((entry) => {
    if (typeof entry !== 'object' || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return (
      typeof e['windowIndex'] === 'number' && Number.isInteger(e['windowIndex']) &&
      typeof e['tabIndex'] === 'number' && Number.isInteger(e['tabIndex'])
    );
  });
}