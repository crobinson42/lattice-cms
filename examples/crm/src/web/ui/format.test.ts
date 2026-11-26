import { expect, it } from 'vitest';
import { formatDate, formatMoney, formatRelative } from './format.js';

// The tests run in an English locale.

it('writes a date-time as its date', () => {
  expect(formatDate('2026-11-25T12:00:00.000Z')).toContain('2026');
});

it('writes a date-time relative to now', () => {
  const now = Date.parse('2026-11-25T12:00:00.000Z');
  expect(formatRelative('2026-11-22T12:00:00.000Z', now)).toBe('3 days ago');
  expect(formatRelative('2026-11-25T14:00:00.000Z', now)).toBe('in 2 hours');
  expect(formatRelative('2026-11-25T11:59:40.000Z', now)).toBe('this minute');
});

it('writes money in whole dollars', () => {
  expect(formatMoney(12500)).toBe('$12,500');
  expect(formatMoney(0)).toBe('$0');
  expect(formatMoney(99.6)).toBe('$100');
});
