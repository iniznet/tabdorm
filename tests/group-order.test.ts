import assert from 'node:assert/strict';
import test from 'node:test';
import {
  groupIdsInStripOrder,
  orderTargetIndex,
  planActiveGroupOrder,
} from '../src/core/group-order.ts';

test('off never moves a group', () => {
  assert.equal(orderTargetIndex('off', [7, 8, 9], 7), null);
});

test('bottom targets the end only when the group is not already there', () => {
  assert.equal(orderTargetIndex('bottom', [7, 8, 9], 7), -1);
  assert.equal(orderTargetIndex('bottom', [7, 8, 9], 9), null);
});

test('top targets index 0 only when the group is not already first', () => {
  assert.equal(orderTargetIndex('top', [7, 8, 9], 9), 0);
  assert.equal(orderTargetIndex('top', [7, 8, 9], 7), null);
});

test('a group outside the strip order is never moved', () => {
  assert.equal(orderTargetIndex('bottom', [7, 8], 42), null);
});

test('a pass whose tab lost the active slot plans nothing', () => {
  // Closing one tab fires two activations: pass 1 was started for tab 1, and tab 2
  // owns the slot by the time it plans. Writing here reorders the group the reader
  // left and steals the slot back, which is the ping-pong.
  const tabs = [
    { id: 1, groupId: 7, index: 0, active: false },
    { id: 2, groupId: 8, index: 1, active: true },
  ];
  assert.equal(planActiveGroupOrder('bottom', tabs, 1), null);
});

test('a current pass plans the bottom move for its own group', () => {
  const tabs = [
    { id: 1, groupId: 7, index: 0, active: true },
    { id: 2, groupId: 8, index: 1, active: false },
  ];
  assert.deepEqual(planActiveGroupOrder('bottom', tabs, 1), { groupId: 7, moveTo: -1 });
});

test('a current pass whose group is already at the end plans no move', () => {
  const tabs = [
    { id: 1, groupId: 8, index: 0, active: false },
    { id: 2, groupId: 7, index: 1, active: true },
  ];
  assert.deepEqual(planActiveGroupOrder('bottom', tabs, 2), { groupId: 7, moveTo: null });
});

test('an active ungrouped tab plans nothing to move', () => {
  const tabs = [{ id: 1, groupId: -1, index: 0, active: true }];
  assert.equal(planActiveGroupOrder('bottom', tabs, 1), null);
});

test('a pass for a tab that is gone plans nothing', () => {
  const tabs = [{ id: 1, groupId: 7, index: 0, active: true }];
  assert.equal(planActiveGroupOrder('bottom', tabs, 42), null);
});

test('off plans nothing even when the pass is current', () => {
  const tabs = [{ id: 1, groupId: 7, index: 0, active: true }];
  assert.equal(planActiveGroupOrder('off', tabs, 1), null);
});

test('strip order follows tab order, drops ungrouped tabs, and dedupes', () => {
  const tabs = [
    { groupId: -1, index: 0 },
    { groupId: 8, index: 1 },
    { groupId: 7, index: 2 },
    { groupId: 8, index: 3 },
  ];
  assert.deepEqual(groupIdsInStripOrder(tabs), [8, 7]);
});

test('strip order sorts unordered input', () => {
  const tabs = [
    { groupId: 9, index: 4 },
    { groupId: 7, index: 0 },
    { groupId: 8, index: 2 },
  ];
  assert.deepEqual(groupIdsInStripOrder(tabs), [7, 8, 9]);
});
