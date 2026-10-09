import type { TabDormConfig, UnifiedSession } from '@/types';
import { getLatestSessionOfType, pruneAutoSnapshots, deleteAutoSnapshotsOlderThan, putSession, pageSessions } from './db';
import { getConfig } from './config-store';
import { contentHashOf } from './hash';
import type { ShadowTree } from './shadow-tree';

export const SNAPSHOT_ALARM = 'tabdorm:snapshot';
const LAST_BACKUP_KEY = 'tabdorm:lastAutoBackupAt';
const DAY_MS = 86_400_000;

/** Shared write path for user-triggered snapshots (popup message + keyboard command). */
export async function saveUserSnapshot(
  shadowTree: ShadowTree,
): Promise<{ sessionId: string; windows: number }> {
  const windows = shadowTree.snapshotAll();
  const session: UnifiedSession = {
    id: crypto.randomUUID(),
    name: `Snapshot — ${new Date().toLocaleString()}`,
    timestamp: Date.now(),
    type: 'user_saved',
    contentHash: contentHashOf(windows),
    windows,
  };
  await putSession(session);
  return { sessionId: session.id, windows: windows.length };
}

/** Creates or clears the periodic snapshot alarm to match the current config. */
export async function syncSnapshotAlarm(config: TabDormConfig): Promise<void> {
  const existing = await chrome.alarms.get(SNAPSHOT_ALARM);
  if (config.snapshots.enabled) {
    if (existing === undefined || existing.periodInMinutes !== config.snapshots.intervalMinutes) {
      await chrome.alarms.clear(SNAPSHOT_ALARM);
      await chrome.alarms.create(SNAPSHOT_ALARM, { periodInMinutes: config.snapshots.intervalMinutes });
    }
  } else if (existing !== undefined) {
    await chrome.alarms.clear(SNAPSHOT_ALARM);
  }
}

/** MUST be registered synchronously at service-worker startup. */
export function registerSnapshotAlarmListener(shadowTree: ShadowTree): void {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SNAPSHOT_ALARM) void runAutoSnapshot(shadowTree);
  });
}

export interface AutoSnapshotResult {
  saved: boolean;
  reason: 'disabled' | 'empty' | 'unchanged' | 'saved';
  prunedByCap: number;
  prunedByAge: number;
}

/**
 * Auto-snapshot tick: dedupes by structural content hash against the most
 * recent auto_snapshot (a no-op browser state must not pile up history), then
 * enforces both retention knobs. Cursor/batch based — never a bulk load.
 */
export async function runAutoSnapshot(shadowTree: ShadowTree): Promise<AutoSnapshotResult> {
  const config = await getConfig();
  if (!config.snapshots.enabled) {
    return { saved: false, reason: 'disabled', prunedByCap: 0, prunedByAge: 0 };
  }
  const windows = shadowTree.snapshotAll();
  if (windows.length === 0) {
    return { saved: false, reason: 'empty', prunedByCap: 0, prunedByAge: 0 };
  }
  const hash = contentHashOf(windows);
  const latest = await getLatestSessionOfType('auto_snapshot');
  if (latest !== undefined && latest.contentHash === hash) {
    return { saved: false, reason: 'unchanged', prunedByCap: 0, prunedByAge: 0 };
  }
  const session: UnifiedSession = {
    id: crypto.randomUUID(),
    name: `Auto snapshot — ${new Date().toLocaleString()}`,
    timestamp: Date.now(),
    type: 'auto_snapshot',
    contentHash: hash,
    windows,
  };
  await putSession(session);

  const prunedByAge =
    config.snapshots.retentionDays > 0
      ? await deleteAutoSnapshotsOlderThan(Date.now() - config.snapshots.retentionDays * DAY_MS)
      : 0;
  const prunedByCap = await pruneAutoSnapshots(config.snapshots.maxSnapshotsRetained);
  return { saved: true, reason: 'saved', prunedByCap, prunedByAge };
}

export interface BackupResult {
  downloaded: boolean;
  reason: 'disabled' | 'not_due' | 'empty' | 'downloaded' | 'failed';
  sessionsExported: number;
}

/**
 * Auto-backup export (chrome.downloads). Data-URL payload: service workers
 * cannot use URL.createObjectURL. autoBackupDownloadDays = 0 disables.
 */
export async function maybeAutoBackup(): Promise<BackupResult> {
  const config = await getConfig();
  const intervalDays = config.snapshots.autoBackupDownloadDays;
  if (intervalDays <= 0) return { downloaded: false, reason: 'disabled', sessionsExported: 0 };
  const stored = await chrome.storage.local.get(LAST_BACKUP_KEY);
  const last = stored[LAST_BACKUP_KEY];
  if (typeof last === 'number' && Date.now() - last < intervalDays * DAY_MS) {
    return { downloaded: false, reason: 'not_due', sessionsExported: 0 };
  }
  // Paginated export: one file, built incrementally through keyset cursors.
  const parts: string[] = [];
  let cursor: number | undefined;
  let count = 0;
  for (;;) {
    const page = await pageSessions({ limit: 50, cursor });
    for (const session of page.items) {
      parts.push(count === 0 ? JSON.stringify(session) : `,${JSON.stringify(session)}`);
      count += 1;
    }
    if (!page.hasMore || page.nextCursor === null) break;
    cursor = page.nextCursor;
  }
  if (count === 0) return { downloaded: false, reason: 'empty', sessionsExported: 0 };
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const dataUrl = `data:application/json;charset=utf-8,[${parts.join('')}]`;
  try {
    await chrome.downloads.download({
      url: dataUrl,
      filename: `tabdorm-backup-${stamp}.json`,
      saveAs: false,
      conflictAction: 'uniquify',
    });
    await chrome.storage.local.set({ [LAST_BACKUP_KEY]: Date.now() });
    return { downloaded: true, reason: 'downloaded', sessionsExported: count };
  } catch (error) {
    console.warn('[tabdorm] auto-backup download failed.', error);
    return { downloaded: false, reason: 'failed', sessionsExported: count };
  }
}
