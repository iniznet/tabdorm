import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSerializer } from '../src/core/serialize.ts';

/** Yield to the macrotask queue so an unserialized task would interleave. */
const yieldToTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

test('serialize runs tasks one at a time, in call order', async () => {
  const serialize = createSerializer();
  const log: string[] = [];
  const task = (name: string) => async (): Promise<string> => {
    log.push(`${name}:start`);
    await yieldToTimers();
    log.push(`${name}:end`);
    return name;
  };

  const results = await Promise.all([serialize(task('a')), serialize(task('b')), serialize(task('c'))]);

  assert.deepEqual(results, ['a', 'b', 'c']);
  assert.deepEqual(log, ['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end']);
});

test('a rejected task rejects its caller and leaves the queue usable', { timeout: 2000 }, async () => {
  const serialize = createSerializer();
  const failed = serialize(async () => {
    throw new Error('boom');
  });

  await assert.rejects(failed, /boom/);
  assert.equal(await serialize(async () => 'after'), 'after');
});

test('two serializers keep separate queues, so one write never stalls another', async () => {
  const first = createSerializer();
  const second = createSerializer();
  const log: string[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  const slow = first(async () => {
    log.push('first:start');
    await held;
    log.push('first:end');
  });
  const quick = second(async () => {
    log.push('second:start');
    log.push('second:end');
  });

  await quick;
  assert.deepEqual(log, ['first:start', 'second:start', 'second:end']);
  release();
  await slow;
  assert.deepEqual(log, ['first:start', 'second:start', 'second:end', 'first:end']);
});
