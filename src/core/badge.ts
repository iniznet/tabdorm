const BADGE_COLOR = '#6366f1';

/** Reflects the number of currently discarded (asleep) tabs on the toolbar badge. */
export async function updateAsleepBadge(): Promise<void> {
  try {
    const asleep = await chrome.tabs.query({ discarded: true });
    await chrome.action.setBadgeText({ text: asleep.length > 0 ? String(asleep.length) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  } catch (error) {
    console.warn('[tabdorm] badge update failed.', error);
  }
}
