/** Requests the UI surfaces may send to the background service worker. */
export type BackgroundRequest =
  | { type: 'snapshotNow' }
  | { type: 'runSweep' }
  | { type: 'suspendTab'; tabId: number }
  | { type: 'restoreSession'; sessionId: string; screen: { availWidth: number; availHeight: number } }
  | { type: 'migrateTms' };

export type BackgroundResponse =
  | { ok: true; payload?: unknown }
  | { ok: false; error: string };

export type RequestType = BackgroundRequest['type'];

const REQUEST_TYPES: readonly RequestType[] = ['snapshotNow', 'runSweep', 'suspendTab', 'restoreSession', 'migrateTms'];

/**
 * Runtime validation for messages crossing the extension boundary — zero blind
 * casting of external data (Zero-Trust ingress rule).
 */
export function parseBackgroundRequest(raw: unknown): { ok: true; request: BackgroundRequest } | { ok: false; error: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: 'Request must be an object.' };
  const candidate = raw as Record<string, unknown>;
  const type = candidate['type'];
  if (
    typeof type !== 'string' ||
    (type !== 'snapshotNow' && type !== 'runSweep' && type !== 'suspendTab' && type !== 'restoreSession' && type !== 'migrateTms')
  ) {
    return { ok: false, error: `Unknown request type: ${String(type)}` };
  }
  switch (type) {
    case 'snapshotNow':
    case 'runSweep':
    case 'migrateTms':
      return { ok: true, request: { type } };
    case 'suspendTab': {
      const tabId = candidate['tabId'];
      if (typeof tabId !== 'number' || !Number.isInteger(tabId)) return { ok: false, error: 'suspendTab requires an integer tabId.' };
      return { ok: true, request: { type, tabId } };
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
      return { ok: true, request: { type, sessionId, screen: { availWidth, availHeight } } };
    }
  }
}
