import { getConfig } from './config-store';

/**
 * Chrome's tab strip is browser UI: no extension API styles it, and `chrome.tabs`
 * exposes no favicon write. The one legal repaint is the page's own
 * `<link rel="icon">`, which Chrome mirrors into the strip and keeps across a
 * native discard — so the mark is injected *before* the tab is discarded.
 *
 * Every path is best-effort. A missing optional grant, a restricted scheme
 * (`chrome://`, the Web Store), or a tab that vanished degrades to "no mark".
 */

/** Moonlight-grey double z, inline so no web-accessible resource is needed. */
const SLEEP_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<text x="13" y="24" font-family="ui-sans-serif, system-ui, sans-serif" font-size="17" font-weight="700" text-anchor="middle" fill="#8a857c" opacity="0.9">z</text>' +
  '<text x="24" y="13" font-family="ui-sans-serif, system-ui, sans-serif" font-size="11" font-weight="700" text-anchor="middle" fill="#8a857c" opacity="0.6">z</text>' +
  '</svg>';

export const SLEEP_ICON_URL = `data:image/svg+xml,${encodeURIComponent(SLEEP_ICON_SVG)}`;

/**
 * The strip picks a new favicon up asynchronously, and a discarded tab has no
 * renderer left to retry from — so the discard waits this long after a paint
 * that actually changed the document. Implementation race guard, not user
 * policy: a constant, deliberately not a config knob.
 */
const ICON_CAPTURE_SETTLE_MS = 220;

/** Chromium refusals that mean "this document is not ours to script". */
const RESTRICTED_TARGET_PATTERNS: readonly RegExp[] = [
  /cannot be scripted/i,
  /Cannot access contents/i,
  /extensions gallery|chrome web store/i,
  /chrome:\/\//i,
  /chrome-extension:\/\//i,
  /No tab with id/i,
];

function isRestrictedTarget(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return RESTRICTED_TARGET_PATTERNS.some((pattern) => pattern.test(message));
}

/** Runs inside the page. executeScript serialises the source, so it closes over nothing. */
function paintInPage(iconUrl: string): boolean {
  const head = document.head;
  if (head === null) return false;
  const links = Array.from(document.querySelectorAll('link[rel~="icon"]')) as HTMLLinkElement[];
  if (links.some((link) => link.dataset['tabdormSleepIcon'] === '1')) return true;
  for (const link of links) {
    link.dataset['tabdormPriorIcon'] = link.getAttribute('href') ?? '';
    link.setAttribute('href', iconUrl);
  }
  const marker = document.createElement('link');
  marker.rel = 'icon';
  marker.setAttribute('href', iconUrl);
  marker.dataset['tabdormSleepIcon'] = '1';
  head.appendChild(marker);
  return true;
}

/** Runs inside the page: puts the page's own favicon declarations back. */
function restoreInPage(): boolean {
  let touched = false;
  for (const link of Array.from(document.querySelectorAll('link[data-tabdorm-prior-icon]')) as HTMLLinkElement[]) {
    const prior = link.dataset['tabdormPriorIcon'];
    if (prior === undefined) continue;
    if (prior === '') link.removeAttribute('href');
    else link.setAttribute('href', prior);
    delete link.dataset['tabdormPriorIcon'];
    touched = true;
  }
  for (const marker of Array.from(document.querySelectorAll('link[data-tabdorm-sleep-icon="1"]'))) {
    marker.remove();
    touched = true;
  }
  return touched;
}

export type SleepIconOutcome = 'painted' | 'off' | 'no_permission' | 'restricted' | 'failed';

async function hasScriptingGrant(): Promise<boolean> {
  try {
    return await chrome.permissions.contains({ permissions: ['scripting'], origins: ['<all_urls>'] });
  } catch {
    return false;
  }
}

/**
 * Replaces the tab's favicon with the sleep mark so the tab strip shows it once
 * the tab is discarded. Returns 'painted' only when a document actually changed.
 */
export async function paintSleepIcon(tabId: number): Promise<SleepIconOutcome> {
  try {
    const config = await getConfig();
    if (!config.suspension.stripSleepIcon) return 'off';
  } catch {
    return 'failed';
  }
  if (!(await hasScriptingGrant())) return 'no_permission';
  let changed = false;
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, args: [SLEEP_ICON_URL], func: paintInPage });
    changed = injection?.result === true;
  } catch (error) {
    if (isRestrictedTarget(error)) return 'restricted';
    console.warn(`[tabdorm] tab-strip sleep mark unavailable for tab ${String(tabId)}.`, error);
    return 'failed';
  }
  if (changed) await new Promise((resolve) => setTimeout(resolve, ICON_CAPTURE_SETTLE_MS));
  return 'painted';
}

/** Puts the page's own favicon back after a discard that did not happen. */
export async function restoreSleepIcon(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, func: restoreInPage });
  } catch {
    // Already discarded or gone: the injected links died with the document.
  }
}
