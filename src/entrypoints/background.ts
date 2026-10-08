import { getConfig, registerConfigInvalidation } from '@/core/config-store';
import { initDatabase } from '@/core/db';
import { flushPendingDiscard } from '@/core/discard';
import { initIdleGuard } from '@/core/idle-guard';
import { routeCommittedNavigation } from '@/core/auto-route';
import { ShadowTree } from '@/core/shadow-tree';
import { ensureConfigPersisted } from '@/core/config-store';

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
  chrome.webNavigation.onCommitted.addListener((details) => {
    void onTopFrameCommitted(details);
  });
  chrome.runtime.onInstalled.addListener(() => {
    void ensureConfigPersisted();
  });
  void bootstrap(shadowTree);
});

async function bootstrap(shadowTree: ShadowTree): Promise<void> {
  try {
    await getConfig();
    await ensureConfigPersisted();
  } catch (error) {
    console.warn('[tabdorm] config bootstrap failed; defaults active.', error);
  }
  void initDatabase();
  await shadowTree.init();
}

/** Shared top-frame commit dispatcher: discard race guard, then auto-routing. */
async function onTopFrameCommitted(
  details: chrome.webNavigation.WebNavigationTransitionCallbackDetails,
): Promise<void> {
  if (details.frameId !== 0) return;
  await flushPendingDiscard(details.tabId);
  await routeCommittedNavigation(details);
}
