import { registerSweepAlarmListener, runSweepOnce, syncSweepAlarm } from '@/core/suspension';
import { ensureColdStartSeeded, forgetActivity, touchActivity } from '@/core/activity';
import { updateAsleepBadge } from '@/core/badge';
import { initContextMenus, suspendOtherTabs } from '@/core/context-menus';
import { restoreSession } from '@/core/restoration';
import { discardTabSafe, flushPendingDiscard } from '@/core/discard';
import { initIdleGuard } from '@/core/idle-guard';
import { routeCommittedNavigation } from '@/core/auto-route';
import { maybeAutoBackup, registerSnapshotAlarmListener, runAutoSnapshot, saveUserSnapshot, syncSnapshotAlarm } from '@/core/snapshots';
import { migrateAll } from '@/core/tms-migrate';
import { initDatabase } from '@/core/db';
import { getConfig, registerConfigInvalidation } from '@/core/config-store';
import { ensureConfigPersisted } from '@/core/config-store';
import { contentHashOf } from '@/core/hash';
import { registerBackgroundMessageHandler } from '@/core/messaging';
import { ShadowTree } from '@/core/shadow-tree';
import type { BackgroundRequest } from '@/types/messages';
import type { UnifiedSession } from '@/types';

/**
 * TabDorm background service worker.
 *
 * MV3 cold-start rule: every chrome.* event listener MUST be registered
 * synchronously here — never after an await — or events fired during worker
 * spin-up are lost. Async work (config warm-up, DB persistence, shadow-tree
 * hydration) happens after registration and must be resilient to races.
 */
export default defineBackground(() => {
  const shadowTree = new ShadowTree();
  shadowTree.install();
  initIdleGuard();
  registerConfigInvalidation();
  registerSweepAlarmListener();
  registerSnapshotAlarmListener(shadowTree);
  registerActivityTracking();
  registerBackgroundMessageHandler((request) => handleMessage(request, shadowTree));
  chrome.commands.onCommand.addListener((command) => {
    void onCommand(command, shadowTree);
  });
  initContextMenus();
  chrome.webNavigation.onCommitted.addListener((details) => {
    void onTopFrameCommitted(details);
  });
  chrome.runtime.onInstalled.addListener((details) => {
    void ensureConfigPersisted();
    if (details.reason === 'install') void chrome.runtime.openOptionsPage();
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || changes['tabdormConfig'] === undefined) return;
    void resyncAlarms();
  });
  void bootstrap(shadowTree);
});

async function resyncAlarms(): Promise<void> {
  const config = await getConfig();
  await syncSweepAlarm(config);
  await syncSnapshotAlarm(config);
}

async function bootstrap(shadowTree: ShadowTree): Promise<void> {
  try {
    const config = await getConfig();
    await ensureConfigPersisted();
    await syncSweepAlarm(config);
    await syncSnapshotAlarm(config);
    await ensureColdStartSeeded();
  } catch (error) {
    console.warn('[tabdorm] config bootstrap failed; defaults active.', error);
  }
  void initDatabase();
  await shadowTree.init();
  void updateAsleepBadge();
}

/** Shared top-frame commit dispatcher: discard race guard, then auto-routing. */
async function onTopFrameCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (details.frameId !== 0) return;
  await flushPendingDiscard(details.tabId);
  await routeCommittedNavigation(details);
}

/** Activity timestamps feed the suspension sweep's idle math. */
function registerActivityTracking(): void {
  chrome.tabs.onActivated.addListener((info) => {
    void touchActivity(info.tabId);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' || changeInfo.audible !== undefined) {
      void touchActivity(tabId);
    }
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void forgetActivity(tabId);
    void updateAsleepBadge();
  });
}

async function handleMessage(request: BackgroundRequest, shadowTree: ShadowTree): Promise<unknown> {
  switch (request.type) {
    case 'snapshotNow':
      return saveUserSnapshot(shadowTree);
    case 'runSweep': {
      const summary = await runSweepOnce();
      await updateAsleepBadge();
      return summary;
    }
    case 'suspendTab': {
      const outcome = await discardTabSafe(request.tabId);
      await updateAsleepBadge();
      return outcome;
    }
    case 'restoreSession':
      return restoreSession(request.sessionId, request.screen);
    case 'migrateTms':
      return migrateAll();
  }
}

async function onCommand(command: string, shadowTree: ShadowTree): Promise<void> {
  if (command === 'tabdorm-suspend-others') {
    const win = await chrome.windows.getLastFocused();
    if (win.id !== undefined) await suspendOtherTabs(win.id);
    await updateAsleepBadge();
    return;
  }
  if (command === 'tabdorm-snapshot-now') {
    await saveUserSnapshot(shadowTree);
  }
}
