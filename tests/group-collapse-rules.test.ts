import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canCollapseGroup,
  pickCollapseTarget,
  selectGroupsToCollapse,
  selectIdleGroups,
  type IdleGroupCandidate,
} from '../src/core/group-collapse-rules.ts';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function candidate(patch: Partial<IdleGroupCandidate> = {}): IdleGroupCandidate {
  return {
    groupId: 7,
    collapsed: false,
    memberActivity: [NOW - 30 * MINUTE],
    hasActiveTabInFocusedWindow: false,
    ...patch,
  };
}

test('a switch collapses the group it left, never the group it entered', () => {
  assert.equal(pickCollapseTarget(7, 8), 7);
  assert.equal(pickCollapseTarget(7, 7), null);
  assert.equal(pickCollapseTarget(-1, 8), null);
});

test('an idle group past the threshold is collapsed', () => {
  assert.deepEqual(selectIdleGroups([candidate()], 10 * MINUTE, NOW), [7]);
});

test('an unknown activity clock blocks the collapse', () => {
  // Regression: a discarded-restored tab never fires status=complete, so its clock
  // stays 0. Reading 0 as "infinitely old" folded every such group in one sweep.
  const unknown = candidate({ memberActivity: [NOW - 30 * MINUTE, 0] });
  assert.deepEqual(selectIdleGroups([unknown], 10 * MINUTE, NOW), []);
});

test('one fresh member keeps the whole group open', () => {
  const mixed = candidate({ memberActivity: [NOW - 30 * MINUTE, NOW - MINUTE] });
  assert.deepEqual(selectIdleGroups([mixed], 10 * MINUTE, NOW), []);
});

test('collapsed groups, focused active groups, and a zero threshold are skipped', () => {
  assert.deepEqual(selectIdleGroups([candidate({ collapsed: true })], 10 * MINUTE, NOW), []);
  assert.deepEqual(selectIdleGroups([candidate({ hasActiveTabInFocusedWindow: true })], 10 * MINUTE, NOW), []);
  assert.deepEqual(selectIdleGroups([candidate()], 0, NOW), []);
  assert.deepEqual(selectIdleGroups([candidate({ memberActivity: [] })], 10 * MINUTE, NOW), []);
});

test('a collapse write is refused for the active group', () => {
  // The invariant behind the cascade: folding the group holding the active tab makes
  // Chromium activate a neighbour, which fires another activation and folds the next.
  assert.equal(canCollapseGroup({ exists: true, collapsed: false, holdsActiveTab: true }), false);
  assert.equal(canCollapseGroup({ exists: true, collapsed: false, holdsActiveTab: false }), true);
  assert.equal(canCollapseGroup({ exists: false, collapsed: false, holdsActiveTab: false }), false);
  assert.equal(canCollapseGroup({ exists: true, collapsed: true, holdsActiveTab: false }), false);
});

test('every expanded group folds except the one you land in', () => {
  const groups = [
    { groupId: 1, collapsed: false },
    { groupId: 2, collapsed: false },
    { groupId: 3, collapsed: false },
  ];
  assert.deepEqual(selectGroupsToCollapse(groups, 2), [1, 3]);
});

test('the active group is never a target, however the list is ordered', () => {
  const groups = [
    { groupId: 5, collapsed: false },
    { groupId: 9, collapsed: false },
  ];
  assert.deepEqual(selectGroupsToCollapse(groups, 5), [9]);
  assert.deepEqual(selectGroupsToCollapse([...groups].reverse(), 5), [9]);
});

test('a group already folded is left alone', () => {
  const groups = [
    { groupId: 1, collapsed: true },
    { groupId: 2, collapsed: false },
    { groupId: 3, collapsed: false },
  ];
  assert.deepEqual(selectGroupsToCollapse(groups, 3), [2]);
});

test('landing on an ungrouped tab folds nothing', () => {
  const groups = [
    { groupId: 1, collapsed: false },
    { groupId: 2, collapsed: false },
  ];
  assert.deepEqual(selectGroupsToCollapse(groups, -1), []);
});

test('one group only: nothing to fold', () => {
  assert.deepEqual(selectGroupsToCollapse([{ groupId: 4, collapsed: false }], 4), []);
  assert.deepEqual(selectGroupsToCollapse([], 4), []);
});
