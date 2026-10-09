/**
 * Zero-configuration site grouping: maps a hostname to a stable group title
 * and color. Pure kernel — no chrome.* dependencies, fully deterministic so a
 * site always lands in the same-looking group across restarts.
 */
import type { GroupColor } from '@/types';

/**
 * Multi-part public suffixes commonly hit by this extension's users — a
 * hand-rolled suffix-lite so "bbc.co.uk" collapses to one domain without a
 * network lookup. Anything not listed falls back to the last two labels.
 */
const MULTI_PART_SUFFIXES: readonly string[] = [
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk',
  'com.au', 'net.au', 'org.au',
  'co.id', 'or.id', 'web.id',
  'com.br', 'com.mx', 'com.ar', 'com.co',
  'co.jp', 'ne.jp', 'or.jp',
  'co.in', 'net.in', 'org.in',
  'com.tr', 'com.cn', 'com.hk', 'com.tw',
  'co.nz', 'com.sg', 'com.my', 'co.za',
  'com.eg', 'com.sa', 'com.ng', 'com.pk', 'com.bd',
  'com.vn', 'com.ph', 'com.th', 'com.pe',
];

/** Friendly titles for well-known sites; every other site keeps its domain. */
const FRIENDLY_TITLES: Readonly<Record<string, string>> = {
  'github.com': 'GitHub',
  'facebook.com': 'Facebook',
  'youtube.com': 'YouTube',
  'x.com': 'X',
  'twitter.com': 'X',
  'reddit.com': 'Reddit',
  'google.com': 'Google',
  'stackoverflow.com': 'Stack Overflow',
  'stackexchange.com': 'Stack Exchange',
  'chatgpt.com': 'ChatGPT',
  'openai.com': 'OpenAI',
  'claude.ai': 'Claude',
  'anthropic.com': 'Anthropic',
  'linkedin.com': 'LinkedIn',
  'instagram.com': 'Instagram',
  'whatsapp.com': 'WhatsApp',
  'discord.com': 'Discord',
  'twitch.tv': 'Twitch',
  'amazon.com': 'Amazon',
  'netflix.com': 'Netflix',
  'microsoft.com': 'Microsoft',
  'apple.com': 'Apple',
  'spotify.com': 'Spotify',
  'medium.com': 'Medium',
  'wikipedia.org': 'Wikipedia',
  'notion.so': 'Notion',
  'slack.com': 'Slack',
  'tiktok.com': 'TikTok',
  'pinterest.com': 'Pinterest',
  'ebay.com': 'eBay',
};

const DOMAIN_COLORS: readonly GroupColor[] = [
  'grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange',
];

/**
 * eTLD+1-ish base domain: strips a leading "www.", keeps IPs/localhost
 * verbatim, and respects the multi-part suffix list above.
 */
export function baseDomainOf(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '');
  if (host === 'localhost' || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) return host;
  const labels = host.split('.').filter((label) => label !== '');
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_PART_SUFFIXES.includes(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

/** Well-known sites get a human title; everything else uses its base domain. */
export function titleForDomain(hostname: string): string {
  const base = baseDomainOf(hostname);
  return FRIENDLY_TITLES[base] ?? base;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Deterministic per-site color — the same site always maps to the same color. */
export function colorForDomain(hostname: string): GroupColor {
  return DOMAIN_COLORS[fnv1a(baseDomainOf(hostname)) % DOMAIN_COLORS.length] ?? 'grey';
}

export interface GroupTarget {
  groupTitle: string;
  groupColor: GroupColor;
  autoCollapse: boolean;
}

/** Site-based fallback target for a URL when no user rule matches. */
export function syntheticGroupForUrl(rawUrl: string): GroupTarget | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  return { groupTitle: titleForDomain(parsed.hostname), groupColor: colorForDomain(parsed.hostname), autoCollapse: false };
}
