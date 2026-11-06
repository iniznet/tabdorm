/**
 * Which context a tab menu hangs off. Pure, no chrome API, so the version rule
 * that once killed the whole menu stays testable in plain node.
 */

/** The version that first accepts the tab context. An API floor, not a setting. */
export const MIN_TAB_CONTEXT_CHROME = 150;

/**
 * Reads the browser's own version instead of probing the API, so an unsupported
 * build never sees a rejected create at all. Anything unparseable falls back to
 * page context, which every Chrome supports.
 */
export function supportsTabContext(userAgent: string): boolean {
  const major = Number(/Chrome\/(\d+)/.exec(userAgent)?.[1] ?? 0);
  return major >= MIN_TAB_CONTEXT_CHROME;
}
