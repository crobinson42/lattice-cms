import { useSyncExternalStore } from 'react';

/**
 * One clock per interval, shared by every reader of it. Its `subscribe`
 * and `read` are made once: a new subscribe each render would have React
 * unsubscribe and subscribe again on every render.
 */
type Clock = {
  readonly subscribe: (listener: () => void) => () => void;
  readonly read: () => number;
};

const clocks = new Map<number, Clock>();

function clockOf(intervalMs: number): Clock {
  const known = clocks.get(intervalMs);
  if (known !== undefined) return known;
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | undefined;
  const listeners = new Set<() => void>();
  const clock: Clock = {
    subscribe: (listener) => {
      if (listeners.size === 0) {
        timer = setInterval(() => {
          now = Date.now();
          for (const notify of listeners) notify();
        }, intervalMs);
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearInterval(timer);
          timer = undefined;
        }
      };
    },
    // A clock no one has read for a while is read afresh; a reader in the
    // same render sees the same time.
    read: () => {
      if (listeners.size === 0 && Date.now() - now >= intervalMs) {
        now = Date.now();
      }
      return now;
    },
  };
  clocks.set(intervalMs, clock);
  return clock;
}

/**
 * The time now, as milliseconds, read again every `intervalMs` while
 * anything on screen reads it: "3 minutes ago" and "Today" move on by
 * themselves. One timer per interval, however many readers.
 */
export function useNow(intervalMs: number): number {
  const { subscribe, read } = clockOf(intervalMs);
  return useSyncExternalStore(subscribe, read);
}
