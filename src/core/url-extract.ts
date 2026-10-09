/** Upper bound on extracted URLs — keeps a pasted dump from becoming an unbounded loop. */
export const MAX_EXTRACTED_URLS = 500;

const URL_PATTERN = /https?:\/\/[^\s<>"`\)\]}]+/g;

/**
 * Extracts unique, well-formed http(s) URLs from arbitrary user text (email,
 * markdown, CSV, prose). Order-preserving; trailing punctuation is stripped.
 */
export function extractUrls(text: string, cap: number = MAX_EXTRACTED_URLS): string[] {
  if (typeof text !== 'string') return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) {
    if (out.length >= cap) break;
    const cleaned = match[0].replace(/[.,;:!?’']+$/, '');
    if (!isValidHttpUrl(cleaned) || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function isValidHttpUrl(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}