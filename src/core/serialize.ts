/**
 * One serialized read-modify-write chain per caller.
 *
 * `chrome.storage.session` and `chrome.storage.local` offer no transactional
 * update, and tab events arrive in bursts: two parallel handlers read the same
 * map, and the later write wins. A module that owns a read-modify-write cycle
 * builds its serializer once at module scope, so its own writes run in call
 * order and the last read is never stale.
 *
 * Each caller gets a private queue. One shared queue would put unrelated keys
 * behind a single lock, and a slow write in one module would stall another.
 */
export type Serializer = <T>(task: () => Promise<T>) => Promise<T>;

export function createSerializer(): Serializer {
  let chain: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    // Run after the previous task settles either way: one rejection must not
    // poison the queue.
    const run = chain.then(task, task);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
