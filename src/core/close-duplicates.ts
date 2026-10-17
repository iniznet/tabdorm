import { getDirtyFormTabs } from '@/core/form-guard';

export interface CloseDuplicateOutcome {
  closed: number[];
  skipped: { tabId: number; reason: 'gone' | 'active' | 'unsaved-form' }[];
}

/** Hard ceiling so a pathological request can never fan out unbounded. */
export const MAX_CLOSE_BATCH = 500;

/**
 * Closes the requested tabs with data-loss guard rails: the active tab of any
 * window and any tab holding unsaved form input are skipped, never closed.
 */
export async function closeDuplicateTabs(requested: readonly number[]): Promise<CloseDuplicateOutcome> {
  const [tabs, dirty] = await Promise.all([chrome.tabs.query({}), getDirtyFormTabs()]);
  const known = new Map<number, chrome.tabs.Tab>();
  for (const tab of tabs) {
    if (tab.id !== undefined) known.set(tab.id, tab);
  }
  const closed: number[] = [];
  const skipped: CloseDuplicateOutcome['skipped'] = [];
  for (const tabId of requested) {
    const tab = known.get(tabId);
    if (tab === undefined) {
      skipped.push({ tabId, reason: 'gone' });
    } else if (tab.active) {
      skipped.push({ tabId, reason: 'active' });
    } else if (dirty.has(tabId)) {
      skipped.push({ tabId, reason: 'unsaved-form' });
    } else {
      closed.push(tabId);
    }
  }
  if (closed.length > 0) await chrome.tabs.remove(closed);
  return { closed, skipped };
}

const SKIP_REASONS: readonly CloseDuplicateOutcome['skipped'][number]['reason'][] = [
  'gone',
  'active',
  'unsaved-form',
];

/** Runtime validator for a close outcome crossing the message boundary. */
export function parseCloseOutcome(payload: unknown): CloseDuplicateOutcome | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  const rawClosed = candidate['closed'];
  const rawSkipped = candidate['skipped'];
  if (!Array.isArray(rawClosed) || !Array.isArray(rawSkipped)) return null;
  const closed: number[] = [];
  for (const value of rawClosed) {
    if (typeof value !== 'number' || !Number.isInteger(value)) return null;
    closed.push(value);
  }
  const skipped: CloseDuplicateOutcome['skipped'] = [];
  for (const value of rawSkipped) {
    if (typeof value !== 'object' || value === null) return null;
    const entry = value as Record<string, unknown>;
    const tabId = entry['tabId'];
    const reason = entry['reason'];
    if (typeof tabId !== 'number' || !Number.isInteger(tabId)) return null;
    if (typeof reason !== 'string' || !(SKIP_REASONS as readonly string[]).includes(reason)) return null;
    skipped.push({ tabId, reason: reason as CloseDuplicateOutcome['skipped'][number]['reason'] });
  }
  return { closed, skipped };
}

/** One-line user-facing summary of a close outcome. */
export function describeCloseOutcome(outcome: CloseDuplicateOutcome): string {
  const keptActive = outcome.skipped.some((entry) => entry.reason === 'active') ? ' · active tab kept' : '';
  const forms = outcome.skipped.filter((entry) => entry.reason === 'unsaved-form').length;
  const formsNote = forms > 0 ? ' · ' + forms + ' skipped (unsaved form)' : '';
  return 'Closed ' + outcome.closed.length + ' tab(s)' + keptActive + formsNote + '.';
}
