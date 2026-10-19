// Several conversations can run at once, but their tools act on one app: a write to the scene on
// screen must not interleave with another chat's write. Every tool call goes through one FIFO lock.

import type { ToolRunner } from './executor';

export type Lock = <T>(task: () => Promise<T>) => Promise<T>;

export function createLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const result = tail.then(task);
    tail = result.catch(() => {});   // a failed task doesn't block the next one
    return result;
  };
}

// A runner whose calls wait their turn on `lock` (shared by every conversation's runner).
export const serialized = (runner: ToolRunner, lock: Lock): ToolRunner => (name, input, call) => lock(() => runner(name, input, call));
