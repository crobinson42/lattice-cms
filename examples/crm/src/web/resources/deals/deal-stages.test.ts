import { expect, it } from 'vitest';
import { allStages, dealStages, isOpen, openStages } from './deal-stages.js';

it('lists the open stages, then the closed ones, each with a label', () => {
  expect(openStages).toEqual(['lead', 'qualified', 'proposal', 'negotiation']);
  expect(allStages.map((stage) => dealStages[stage].label)).toEqual([
    'Lead',
    'Qualified',
    'Proposal',
    'Negotiation',
    'Won',
    'Lost',
  ]);
});

it('a deal is open until it closes', () => {
  expect(isOpen({})).toBe(true);
  expect(isOpen({ closedAt: '2026-11-26T12:00:00.000Z' })).toBe(false);
});
