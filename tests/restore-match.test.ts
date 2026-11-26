import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findBestSnapshotWindow,
  GUARD_COUNT_TOLERANCE,
  planRediscards,
  restoreMatchRatio,
  type GuardTab,
} from '../src/core/restore-match.ts';
import type { StoredTab } from '../src/types/session.ts';

interface TabInput {
  url: string;
  asleep?: boolean;
  active?: boolean;
  pinned?: boolean;
  discarded?: boolean;
  status?: string;
}

function stored(url: string, asleep = false): StoredTab {
  return { url, title: url, pinned: false, isDiscarded: asleep };
}

function live(id: number, input: TabInput): GuardTab {
  return {
    id,
    url: input.url,
    active: input.active === true,
    pinned: input.pinned === true,
    discarded: input.discarded === true,
    status: input.status ?? 'complete',
  };
}

function strip(inputs: readonly TabInput[]): GuardTab[] {
  return inputs.map((input, index) => live(index + 1, input));
}

const OPTIONS = { minTabs: 5, countTolerance: GUARD_COUNT_TOLERANCE, matchPct: 80 };
const NO_PROTECTION = { pinnedExempt: true, isProtected: (): boolean => false };

test('a strip rebuilt from the same urls matches itself', () => {
  const urls = ['https://a.test/1', 'https://b.test/2', 'https://c.test/3'];
  const ratio = restoreMatchRatio(
    urls.map((url) => stored(url)),
    strip(urls.map((url) => ({ url }))),
  );
  assert.equal(ratio, 1);
});

test('a shift by one position is a mismatch, not a partial match', () => {
  const ratio = restoreMatchRatio(
    [stored('https://a.test/1'), stored('https://b.test/2')],
    strip([{ url: 'https://b.test/2' }, { url: 'https://a.test/1' }]),
  );
  assert.equal(ratio, 0);
});

test('query order and www are the same page', () => {
  const ratio = restoreMatchRatio(
    [stored('https://www.example.test/path?b=2&a=1')],
    strip([{ url: 'https://example.test/path?a=1&b=2' }]),
  );
  assert.equal(ratio, 1);
});

test('an about:blank tab never votes', () => {
  const ratio = restoreMatchRatio(
    [stored('about:blank'), stored('https://a.test/1')],
    strip([{ url: 'https://b.test/2' }, { url: 'https://a.test/1' }]),
  );
  assert.equal(ratio, 1);
});

test('a strip below the minimum tab count never matches', () => {
  const urls = ['https://a.test/1', 'https://b.test/2', 'https://c.test/3', 'https://d.test/4'];
  const found = findBestSnapshotWindow(
    strip(urls.map((url) => ({ url }))),
    [urls.map((url) => stored(url))],
    OPTIONS,
  );
  assert.equal(found, undefined);
});

test('a strip whose count drifted past tolerance is never compared', () => {
  const storedUrls = ['https://a.test/1', 'https://b.test/2', 'https://c.test/3', 'https://d.test/4', 'https://e.test/5', 'https://f.test/6'];
  const liveUrls = storedUrls.slice(0, 5);
  const found = findBestSnapshotWindow(
    strip(liveUrls.map((url) => ({ url }))),
    [storedUrls.map((url) => stored(url))],
    OPTIONS,
  );
  assert.equal(found, undefined);
});

test('the best of several candidates wins', () => {
  const liveUrls = ['https://a.test/1', 'https://b.test/2', 'https://c.test/3', 'https://d.test/4', 'https://e.test/5'];
  const better = liveUrls.map((url) => stored(url));
  const worse = [...liveUrls.slice(0, 4), 'https://z.test/9'].map((url) => stored(url));
  const found = findBestSnapshotWindow(
    strip(liveUrls.map((url) => ({ url }))),
    [worse, better],
    OPTIONS,
  );
  assert.deepEqual(found?.map((tab) => tab.url), liveUrls);
});

test('a match below the configured percentage is refused', () => {
  const liveUrls = ['https://a.test/1', 'https://b.test/2', 'https://c.test/3', 'https://d.test/4', 'https://e.test/5'];
  const drifted = [...liveUrls.slice(0, 3), 'https://x.test/8', 'https://y.test/9'];
  const found = findBestSnapshotWindow(
    strip(liveUrls.map((url) => ({ url }))),
    [drifted.map((url) => stored(url))],
    OPTIONS,
  );
  assert.equal(found, undefined);
});

test('only tabs asleep in the snapshot are put back to sleep', () => {
  const snapshot = [stored('https://a.test/1', true), stored('https://b.test/2', false)];
  const targets = planRediscards(snapshot, strip([{ url: 'https://a.test/1' }, { url: 'https://b.test/2' }]), NO_PROTECTION);
  assert.deepEqual(targets, [{ tabId: 1, deferred: false }]);
});

test('the focused, the pinned, the protected and the already asleep are left alone', () => {
  const snapshot = [
    stored('https://a.test/1', true),
    stored('https://b.test/2', true),
    stored('https://c.test/3', true),
    stored('https://d.test/4', true),
    stored('https://e.test/5', true),
  ];
  const liveTabs = strip([
    { url: 'https://a.test/1', active: true },
    { url: 'https://b.test/2', pinned: true },
    { url: 'https://c.test/3', status: 'loading' },
    { url: 'https://d.test/4', discarded: true },
    { url: 'https://e.test/5' },
  ]);
  const targets = planRediscards(snapshot, liveTabs, {
    pinnedExempt: true,
    isProtected: (url) => url.includes('e.test'),
  });
  assert.deepEqual(targets, [{ tabId: 3, deferred: true }]);
});

test('a pinned tab is put to sleep when the exemption is off', () => {
  const targets = planRediscards(
    [stored('https://a.test/1', true)],
    strip([{ url: 'https://a.test/1', pinned: true }]),
    { pinnedExempt: false, isProtected: (): boolean => false },
  );
  assert.deepEqual(targets, [{ tabId: 1, deferred: false }]);
});
