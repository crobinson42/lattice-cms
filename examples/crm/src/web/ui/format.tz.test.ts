import { expect, it } from 'vitest';
import { formatDay } from './format.js';

// Behind UTC, where reading "2026-12-01" as UTC midnight would show Nov 30.
// Node reads TZ again when it changes; nothing here has made a date yet.
process.env.TZ = 'Pacific/Honolulu';

it('writes a plain date as its own day, behind UTC too', () => {
  expect(new Date(Date.UTC(2026, 11, 1)).getDate()).toBe(30);
  expect(formatDay('2026-12-01')).toBe('Dec 1, 2026');
});
