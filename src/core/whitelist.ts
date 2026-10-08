/**
 * Whitelist helpers for the exemption URL-pattern list.
 * Patterns use the same match-pattern-lite dialect as AutoRouteRule.
 */

/** Builds a hostname-scoped whitelist pattern for an http(s) URL, or null. */
export function hostnamePattern(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (parsed.hostname === '') return null;
    return `*://${parsed.hostname}/*`;
  } catch {
    return null;
  }
}
