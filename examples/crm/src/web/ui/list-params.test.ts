import { expect, it } from 'vitest';
import { readListParams, writeListParams } from './list-params.js';

const sorts = [
  { value: 'name', label: 'Name' },
  { value: '-updatedAt', label: 'Last updated' },
] as const;

it('reads the search and the sort, with the fallback for anything else', () => {
  expect(readListParams('', sorts, 'name')).toEqual({ q: '', sort: 'name' });
  expect(readListParams('q=%20acme%20&sort=-updatedAt', sorts, 'name')).toEqual(
    { q: 'acme', sort: '-updatedAt' },
  );
  expect(readListParams('?sort=-amount', sorts, 'name')).toEqual({
    q: '',
    sort: 'name',
  });
});

it('writes only what differs from the defaults', () => {
  expect(writeListParams({ q: '', sort: 'name' }, 'name')).toBe('');
  expect(
    writeListParams({ q: 'blue harbor', sort: '-updatedAt' }, 'name'),
  ).toBe('?q=blue+harbor&sort=-updatedAt');
  expect(
    readListParams(
      writeListParams({ q: 'a&b', sort: 'name' }, 'name'),
      sorts,
      'name',
    ),
  ).toEqual({ q: 'a&b', sort: 'name' });
});

it("keeps the list's other keys, such as a filter", () => {
  expect(
    writeListParams({ q: 'fuel', sort: 'name' }, 'name', '?stage=won&q=old'),
  ).toBe('?stage=won&q=fuel');
  expect(writeListParams({ q: '', sort: 'name' }, 'name', '?q=old')).toBe('');
});
