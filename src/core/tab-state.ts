/**
 * Pure sleep-state language for live tabs: one classifier that names where a tab
 * sits in its sleep cycle, so every surface speaks the same vocabulary.
 *
 * Display-only — nothing here discards, closes, or writes storage. The suspension
 * decision matrix in `suspension.ts` stays the single policy engine; this module
 * only explains the same inputs in one word. No `chrome.*` calls: callers pass
 * resolved values, which keeps the rules testable outside the browser.
 */

import type { TabDormConfig } from '@/types';
import { matchesUrlPattern } from './auto-route';
import { durationLabel } from './stale';

export type TabStateKind = 'active' | 'awake' | 'due' | 'asleep' | 'protected';

/** Why a tab cannot sleep. `null` for every state that can. */
export type TabProtection = 'whitelisted' | 'shielded' | 'pinned' | 'audible';

export interface TabState {
  kind: TabStateKind;
  /** One short label for a row's meta line ("asleep", "sleeps in 12 min"). */
  label: string;
  /** Milliseconds until the sweep would discard the tab; null when it cannot sleep. */
  sleepInMs: number | null;
  /** Set only for `protected`; names the reason for the shield. */
  protection: TabProtection | null;
}

export interface TabStateInput {
  active: boolean;
  discarded: boolean;
  pinned: boolean;
  audible: boolean;
  /** `chrome.tabs.Tab.autoDiscardable`: false means a shield already forbids discarding. */
  autoDiscardable: boolean;
  url: string;
  /** Suspension URL whitelist (match-pattern-lite) from config. */
  urlPatterns: readonly string[];
  exemptions: Pick<TabDormConfig['suspension']['exemptions'], 'pinnedTabs' | 'audibleTabs'>;
  /** 0 when no clock has been observed yet (browser run before cold-start seeding). */
  lastActivityAt: number;
  now: number;
  idleThresholdMs: number;
}

/**
 * Refresh cadence for sleep countdowns. A display cadence, not a suspension
 * rule — the sweep interval stays in `TabDormConfig`.
 */
export const SLEEP_CLOCK_TICK_MS = 30_000;

const PROTECTED_LABEL: Record<TabProtection, string> = {
  whitelisted: 'never sleeps',
  shielded: 'shielded',
  pinned: 'pinned',
  audible: 'audio',
};

/**
 * Decision order mirrors the sweep: what is already asleep, what the user is
 * looking at, what is forbidden from sleeping, then the remaining clock. An
 * unknown clock reads as awake, never as asleep.
 */
export function classifyTabState(input: TabStateInput): TabState {
  if (input.discarded) return { kind: 'asleep', label: 'asleep', sleepInMs: null, protection: null };
  if (input.active) return { kind: 'active', label: 'focused', sleepInMs: null, protection: null };
  const protection = protectionOf(input);
  if (protection !== null) {
    return { kind: 'protected', label: PROTECTED_LABEL[protection], sleepInMs: null, protection };
  }
  if (input.lastActivityAt <= 0) return { kind: 'awake', label: 'awake', sleepInMs: null, protection: null };
  const remaining = input.idleThresholdMs - Math.max(0, input.now - input.lastActivityAt);
  if (remaining <= 0) return { kind: 'due', label: 'due to sleep', sleepInMs: 0, protection: null };
  return { kind: 'awake', label: `sleeps in ${durationLabel(remaining)}`, sleepInMs: remaining, protection: null };
}

function protectionOf(input: TabStateInput): TabProtection | null {
  if (matchesUrlPattern(input.url, input.urlPatterns)) return 'whitelisted';
  if (!input.autoDiscardable) return 'shielded';
  if (input.pinned && input.exemptions.pinnedTabs) return 'pinned';
  if (input.audible && input.exemptions.audibleTabs) return 'audible';
  return null;
}
