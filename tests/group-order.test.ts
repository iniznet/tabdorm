import assert from 'node:assert/strict';
import test from 'node:test';
import { groupIdsInStripOrder, orderTargetIndex } from '../src/core/group-order.ts';

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
