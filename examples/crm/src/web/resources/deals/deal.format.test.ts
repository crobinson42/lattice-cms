import { expect, it } from 'vitest';
import { dealCount, isOverdue, openDealCount } from './deal.format.js';

it('counts deals', () => {
  expect(dealCount(1)).toBe('1 deal');
  expect(dealCount(3)).toBe('3 deals');
  expect(openDealCount(1)).toBe('1 open deal');
  expect(openDealCount(14)).toBe('14 open deals');
});

it('an open deal past its expected close date is overdue', () => {
  const today = '2026-11-26';
  expect(isOverdue({ expectedCloseDate: '2026-11-25' }, today)).toBe(true);
  expect(isOverdue({ expectedCloseDate: '2026-11-26' }, today)).toBe(false);
  expect(isOverdue({ expectedCloseDate: '2026-12-01' }, today)).toBe(false);
  expect(isOverdue({}, today)).toBe(false);
  expect(
    isOverdue(
      { expectedCloseDate: '2026-11-01', closedAt: '2026-11-20T10:00:00Z' },
      today,
    ),
  ).toBe(false);
});
