import { TAB_GROUP_ID_NONE } from '@/types';
import { parseMarvellousSuspenderUrl } from './sanitize';
import { scheduleDiscardOnCommit } from './discard';

export interface MigratableTab {
  tabId: number;
  targetUrl: string;
  title?: string;
  groupId?: number;
}

/**
 * Pure selection: finds Marvellous Suspender tabs. The parser guarantees the
 * destination keeps its own query parameters (everything after `uri=`).
 */
export function selectMigratableTabs(
  tabs: readonly { id?: number; url?: string; groupId?: number }[],
): MigratableTab[] {
  const out: MigratableTab[] = [];
  for (const tab of tabs) {
    if (tab.id === undefined || tab.url === undefined) continue;
    const migration = parseMarvellousSuspenderUrl(tab.url);
    if (migration === null) continue;
    out.push({
      tabId: tab.id,
      targetUrl: migration.targetUrl,
      title: migration.title,
      groupId: tab.groupId !== undefined && tab.groupId !== TAB_GROUP_ID_NONE ? tab.groupId : undefined,
    });
  }
  return out;
}

export interface MigrationSummary {
  found: number;
  migrated: number;
  failed: number;
}

/**
 * Scans every open tab for TMS suspended pages and migrates them in place.
 * Navigation preserves the tab's native groupId by construction; the commit
 * race guard discards the tab natively once the real URL has committed
 * (active tabs are skipped by the safe wrapper — the user is looking at them).
 */
export async function migrateAll(): Promise<MigrationSummary> {
  const tabs = await chrome.tabs.query({});
  const candidates = selectMigratableTabs(tabs);
  const summary: MigrationSummary = { found: candidates.length, migrated: 0, failed: 0 };
  for (const candidate of candidates) {
    try {
      await chrome.tabs.update(candidate.tabId, { url: candidate.targetUrl });
      scheduleDiscardOnCommit(candidate.tabId);
      summary.migrated += 1;
    } catch (error) {
      console.warn(`[tabdorm] TMS migration failed for tab ${candidate.tabId}.`, error);
      summary.failed += 1;
    }
  }
  return summary;
}
