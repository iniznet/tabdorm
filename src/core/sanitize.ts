/** Keys whose values must never reach persisted snapshots. */
const SENSITIVE_PARAM_PATTERN =
  /^(token|auth|access_token|refresh_token|api_key|apikey|session|sid|utm_[a-z0-9_-]+)$/i;

/** Strips sensitive query parameters; returns the input unchanged when parsing fails. */
export function stripSensitiveParams(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.search === '') return url;
  const kept = new URLSearchParams();
  let removed = false;
  for (const [key, value] of parsed.searchParams) {
    if (SENSITIVE_PARAM_PATTERN.test(key)) {
      removed = true;
      continue;
    }
    kept.append(key, value);
  }
  if (!removed) return url;
  const query = kept.toString();
  return `${parsed.origin}${parsed.pathname}${query ? `?${query}` : ''}${parsed.hash}`;
}

/** Only standard, non-incognito windows are eligible for snapshots. */
export interface WindowShape {
  incognito?: boolean;
  type?: string;
}

export function isSavableWindow(win: WindowShape): boolean {
  return win.incognito === false && win.type === 'normal';
}

/** Resolves the committed-or-pending URL of a tab, never returning an empty string. */
export function safeTabUrl(tab: { url?: string; pendingUrl?: string }): string {
  return tab.url || tab.pendingUrl || 'about:blank';
}

export interface SuspenderMigration {
  sourceUrl: string;
  targetUrl: string;
  title?: string;
}

/**
 * Parses a Marvellous Suspender URL (suspended.html#ttl=...&uri=...).
 * Everything after `uri=` is taken verbatim as the destination so target URLs
 * containing their own query parameters survive intact.
 */
export function parseMarvellousSuspenderUrl(rawUrl: string): SuspenderMigration | null {
  if (!rawUrl.includes('suspended.html')) return null;
  const hashIndex = rawUrl.indexOf('#');
  if (hashIndex === -1) return null;
  const hash = rawUrl.slice(hashIndex + 1);
  const uriMatch = /(?:^|&)uri=/.exec(hash);
  if (!uriMatch) return null;
  const uriStart = uriMatch.index + uriMatch[0].length;
  const rawTarget = hash.slice(uriStart);
  let target = rawTarget;
  try {
    target = decodeURIComponent(rawTarget);
  } catch {
    // Target was not URI-encoded (TMS legacy form); use it verbatim.
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return null;
  const ttlMatch = /(?:^|&)ttl=([^&]*)/.exec(hash.slice(0, uriMatch.index + 1));
  const ttlRaw = ttlMatch?.[1];
  let title: string | undefined;
  if (ttlRaw !== undefined) {
    try {
      title = decodeURIComponent(ttlRaw.replace(/\+/g, ' '));
    } catch {
      title = ttlRaw;
    }
  }
  return { sourceUrl: rawUrl, targetUrl: target, title: title === '' ? undefined : title };
}
