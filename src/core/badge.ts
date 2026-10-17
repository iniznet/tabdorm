const BADGE_COLOR = '#6366f1';

/**
 * Reflects the number of currently discarded (asleep) tabs on the toolbar badge,
 * and names both counts in the action title so the state reads without a panel.
 */
export async function updateAsleepBadge(): Promise<void> {
  try {
    const [asleep, open] = await Promise.all([chrome.tabs.query({ discarded: true }), chrome.tabs.query({})]);
    await chrome.action.setBadgeText({ text: asleep.length > 0 ? String(asleep.length) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
    await chrome.action.setTitle({
      title:
        asleep.length > 0
          ? `TabDorm — ${String(asleep.length)} of ${String(open.length)} tabs asleep`
          : 'TabDorm — no tabs asleep',
    });
  } catch (error) {
    console.warn('[tabdorm] badge update failed.', error);
  }
}
