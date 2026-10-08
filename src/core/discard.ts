/** Chromium errors that are expected side effects of racing tab lifecycles. */
const BENIGN_DISCARD_PATTERNS: readonly RegExp[] = [
  /Tabs cannot be edited right now/i,
  /No tab with id/i,
  /A tab with id/i,
  /tab was (already )?discarded/i,
  /cannot be (discarded|suspended)/i,
  /frame with ID/i,
];

export function isBenignRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return BENIGN_DISCARD_PATTERNS.some((pattern) => pattern.test(message));
}

export type DiscardOutcome = 'discarded' | 'already_discarded' | 'skipped' | 'failed';

/**
 * Native-first discard wrapper. Never throws: benign Chromium races (tab gone,
 * already discarded, user dragging the strip) are swallowed; unexpected errors
 * are logged and reported as 'failed' so the suspension sweep keeps running.
 */
export async function discardTabSafe(tabId: number): Promise<DiscardOutcome> {
  let tab: chrome.tabs.Tab | undefined;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch {
    return 'already_discarded';
  }
  if (tab.discarded) return 'already_discarded';
  if (tab.active) return 'skipped';
  try {
    await chrome.tabs.discard(tabId);
    return 'discarded';
  } catch (error) {
    if (isBenignRuntimeError(error)) return 'skipped';
    console.warn(`[tabdorm] discard failed for tab ${tabId}.`, error);
    return 'failed';
  }
}

/**
 * Discard Race Guard: tabs flagged here are NOT discarded synchronously at
 * creation time. They are held until webNavigation.onCommitted proves the
 * renderer committed a real document, then discarded once.
 */
const pendingDiscards = new Set<number>();

export function scheduleDiscardOnCommit(tabId: number): void {
  pendingDiscards.add(tabId);
}

export function hasPendingDiscard(tabId: number): boolean {
  return pendingDiscards.has(tabId);
}

export async function flushPendingDiscard(tabId: number): Promise<void> {
  if (!pendingDiscards.delete(tabId)) return;
  await discardTabSafe(tabId);
}
