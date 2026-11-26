import { expect, it } from 'vitest';
import { isoDateTime } from './form.js';
import { dayGroups, formatDay, toLocalInput } from './format.js';

// Behind UTC, where reading "2026-12-01" as UTC midnight would show Nov 30.
// Node reads TZ again when it changes; nothing here has made a date yet.
process.env.TZ = 'Pacific/Honolulu';

it('writes a plain date as its own day, behind UTC too', () => {
  expect(new Date(Date.UTC(2026, 11, 1)).getDate()).toBe(30);
  expect(formatDay('2026-12-01')).toBe('Dec 1, 2026');
});

it('turns a datetime-local value into ISO and back, in the local zone', () => {
  // 9:30 in Honolulu is 19:30 UTC.
  expect(isoDateTime('2026-11-26T09:30')).toBe('2026-11-26T19:30:00.000Z');
  expect(toLocalInput('2026-11-26T19:30:00.000Z')).toBe('2026-11-26T09:30');
  // Late on the 26th in UTC is still the 26th's morning here.
  expect(toLocalInput('2026-11-27T05:00:00.000Z')).toBe('2026-11-26T19:00');
  expect(isoDateTime('')).toBe('');
  expect(isoDateTime('not a time')).toBe('not a time');
});

it('groups by the local day, not the UTC one', () => {
  const now = new Date(2026, 10, 26, 12, 0);
  const groups = dayGroups(
    [
      '2026-11-26T20:00:00.000Z', // 10:00 today
      '2026-11-26T05:00:00.000Z', // 19:00 yesterday, though the 26th in UTC
      '2026-11-24T22:00:00.000Z', // 12:00 on the 24th
    ],
    (at) => at,
    now,
  );
  expect(groups.map(({ label, items }) => [label, items.length])).toEqual([
    ['Today', 1],
    ['Yesterday', 1],
    ['Nov 24, 2026', 1],
  ]);
});
