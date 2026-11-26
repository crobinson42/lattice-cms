import { orderOf } from '@latticecms/core/store';
import { describe, expect, it } from 'vitest';
import { and, escapeRegex, toFilter, toSort } from './filter.js';

describe('toFilter', () => {
  it('maps each comparison one to one', () => {
    expect(
      toFilter({
        a: { eq: 1 },
        b: { ne: 'x' },
        c: { in: ['x', null] },
        d: { nin: [true] },
        e: { gt: 1, lte: 9 },
        f: { gte: 'a', lt: 'b' },
      }),
    ).toEqual({
      a: { $eq: 1 },
      b: { $ne: 'x' },
      c: { $in: ['x', null] },
      d: { $nin: [true] },
      e: { $gt: 1, $lte: 9 },
      f: { $gte: 'a', $lt: 'b' },
    });
  });

  it('keeps null as Mongo reads it: eq null is null or missing', () => {
    expect(toFilter({ a: { eq: null }, b: { ne: null } })).toEqual({
      a: { $eq: null },
      b: { $ne: null },
    });
  });

  it('maps exists to "has a value", so null does not exist', () => {
    expect(toFilter({ a: { exists: true }, b: { exists: false } })).toEqual({
      a: { $ne: null },
      b: { $eq: null },
    });
  });

  it('maps contains to an escaped, case-insensitive regex', () => {
    expect(toFilter({ a: { contains: 'a.b*(c)' } })).toEqual({
      a: { $regex: 'a\\.b\\*\\(c\\)', $options: 'i' },
    });
    // Built from parts: a literal "${" reads as a template placeholder.
    const metacharacters = [
      '.',
      '*',
      '+',
      '?',
      '^',
      '$',
      '{',
      '}',
      '(',
      ')',
      '|',
      '[',
      ']',
      '\\',
      '/',
      '-',
    ].join('');
    expect(escapeRegex(metacharacters)).toBe(
      metacharacters.replace(/./g, (char) => `\\${char}`),
    );
    expect(
      new RegExp(`^${escapeRegex(metacharacters)}$`).test(metacharacters),
    ).toBe(true);
  });

  it('splits one field’s operators into clauses when two map to the same one', () => {
    expect(toFilter({ a: { ne: 'x', exists: true } })).toEqual({
      $and: [{ a: { $ne: 'x' } }, { a: { $ne: null } }],
    });
    expect(toFilter({ a: { eq: null, exists: false } })).toEqual({
      $and: [{ a: { $eq: null } }, { a: { $eq: null } }],
    });
  });

  it('maps has to equality, which Mongo matches against any element', () => {
    expect(toFilter({ tags: { has: 'x' } })).toEqual({ tags: { $eq: 'x' } });
    expect(toFilter({ tags: { has: 'x', exists: true } })).toEqual({
      tags: { $eq: 'x', $ne: null },
    });
  });

  it('maps and and or, nested, beside fields', () => {
    expect(
      toFilter({
        a: { eq: 1 },
        or: [{ b: { eq: 2 } }, { and: [{ c: { gt: 3 } }, { d: { eq: 4 } }] }],
      }),
    ).toEqual({
      $and: [
        { a: { $eq: 1 } },
        {
          $or: [
            { b: { $eq: 2 } },
            { $and: [{ c: { $gt: 3 } }, { d: { $eq: 4 } }] },
          ],
        },
      ],
    });
    expect(toFilter({ and: [{ a: { eq: 1 } }] })).toEqual({ a: { $eq: 1 } });
  });

  it('matches nothing for an empty or, and everything for an empty and', () => {
    expect(toFilter({ or: [] })).toEqual({ $expr: false });
    expect(toFilter({ and: [] })).toEqual({});
    expect(toFilter(undefined)).toEqual({});
  });

  it('maps id to _id', () => {
    expect(toFilter({ id: { in: ['a'] }, or: [{ id: { gt: 'b' } }] })).toEqual({
      $and: [{ _id: { $in: ['a'] } }, { $or: [{ _id: { $gt: 'b' } }] }],
    });
  });
});

describe('and', () => {
  it('never merges by spreading, so a filter on _id cannot replace the id match', () => {
    expect(and({ _id: 'p1' }, toFilter({ id: { ne: 'p1' } }))).toEqual({
      $and: [{ _id: 'p1' }, { _id: { $ne: 'p1' } }],
    });
  });

  it('drops empty filters', () => {
    expect(and({ _id: 'p1' }, {}, undefined)).toEqual({ _id: 'p1' });
    expect(and()).toEqual({});
  });
});

describe('toSort', () => {
  it('keeps key order and direction, with id as _id', () => {
    expect(toSort(orderOf(['-a', 'b'], []))).toEqual([
      ['a', -1],
      ['b', 1],
      ['_id', 1],
    ]);
  });
});
