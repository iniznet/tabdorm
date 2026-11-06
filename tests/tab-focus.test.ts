import assert from 'node:assert/strict';
import test from 'node:test';
import { pickFocusCandidate, type FocusableTab } from '../src/core/tab-focus.ts';

function tab(id: number, index: number, lastAccessed: number, discarded = false): FocusableTab {
  return { id, index, lastAccessed, discarded };
}

test('focus moves to the most recently used sibling', () => {
  const tabs = [tab(1, 0, 100), tab(2, 1, 900), tab(3, 2, 400)];
  assert.equal(pickFocusCandidate(tabs, 1)?.id, 2);
});

test('the active tab is never its own successor', () => {
  const tabs = [tab(1, 0, 999), tab(2, 1, 100)];
  assert.equal(pickFocusCandidate(tabs, 1)?.id, 2);
});

test('a discarded sibling is skipped so nothing has to reload', () => {
  const tabs = [tab(1, 0, 500), tab(2, 1, 900, true), tab(3, 2, 100)];
  assert.equal(pickFocusCandidate(tabs, 1)?.id, 3);
});

test('equal recency breaks on index, never on iteration order', () => {
  const tabs = [tab(7, 3, 500), tab(4, 1, 500)];
  assert.equal(pickFocusCandidate(tabs, 1)?.id, 4);
  assert.equal(pickFocusCandidate([...tabs].reverse(), 1)?.id, 4);
});

test('a window with one usable tab has nowhere to move focus', () => {
  assert.equal(pickFocusCandidate([tab(1, 0, 500)], 1), null);
  assert.equal(pickFocusCandidate([tab(1, 0, 500), tab(2, 1, 900, true)], 1), null);
  assert.equal(pickFocusCandidate([], 1), null);
});
