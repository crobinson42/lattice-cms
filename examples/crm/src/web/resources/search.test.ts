import { expect, it } from 'vitest';
import { resultCount, searchState } from './search.js';

const found = {
  companies: [{ id: 'c1', name: 'Acme' }],
  contacts: [],
  deals: [],
};

it('is idle with nothing typed, and searching until this query’s answer', () => {
  expect(searchState(undefined, '  ')).toEqual({ status: 'idle' });
  expect(searchState(undefined, 'ac')).toEqual({
    status: 'searching',
    query: 'ac',
  });
  // An answer to a query typed past is never shown.
  expect(searchState({ query: 'a', found }, 'ac')).toEqual({
    status: 'searching',
    query: 'ac',
  });
});

it('shows this query’s results, none, or its failure', () => {
  expect(searchState({ query: 'ac', found }, ' ac ')).toEqual({
    status: 'found',
    query: 'ac',
    found,
  });
  expect(
    searchState(
      { query: 'zz', found: { companies: [], contacts: [], deals: [] } },
      'zz',
    ),
  ).toEqual({ status: 'none', query: 'zz' });
  expect(searchState({ query: 'ac', failed: true }, 'ac')).toEqual({
    status: 'failed',
    query: 'ac',
  });
});

it('counts results in words', () => {
  expect(resultCount(found)).toBe('1 result');
  expect(
    resultCount({
      ...found,
      companies: [...found.companies, ...found.companies],
    }),
  ).toBe('2 results');
});
