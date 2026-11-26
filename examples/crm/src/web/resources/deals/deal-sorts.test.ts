import { expect, it } from 'vitest';
import { dealSorts } from './deal-sorts.js';

it('offers the amount sort only to a member who reads amounts', () => {
  expect(dealSorts(true).map(({ value }) => value)).toContain('-amount');
  expect(dealSorts(false).map(({ value }) => value)).not.toContain('-amount');
});
