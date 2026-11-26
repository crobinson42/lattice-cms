import { useSyncExternalStore } from 'react';

/** One clock per interval, shared by every reader of it. */
type Clock = {
  now: number;
  readonly listeners: Set<() => void>;
  timer: ReturnType<typeof setInterval> | undefined;
};

const clocks = new Map<number, Clock>();

function clockOf(intervalMs: number): Clock {
  const known = clocks.get(intervalMs);
  if (known !== undefined) return known;
  const clock: Clock = {
    now: Date.now(),
    listeners: new Set(),
    timer: undefined,
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
  const clock = clockOf(intervalMs);
  return useSyncExternalStore(
    (listener) => {
      if (clock.listeners.size === 0) {
        // The first reader in a while starts from the real time.
        clock.now = Date.now();
        clock.timer = setInterval(() => {
          clock.now = Date.now();
          for (const notify of clock.listeners) notify();
        }, intervalMs);
      }
      clock.listeners.add(listener);
      return () => {
        clock.listeners.delete(listener);
        if (clock.listeners.size === 0) {
          clearInterval(clock.timer);
          clock.timer = undefined;
        }
      };
    },
    () => clock.now,
  );
}
