import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { AppUseCase, callContext } from './fixtures/context.js';
import { type Forms, forms } from './fixtures/forms.js';
import { validationPaths } from './fixtures/validation.js';
import { collection, framework, type Sort } from './index.js';
import { type IsSortable, parseSort, sortable } from './sort.js';

const Things = collection('things', {
  schema: z.object({
    name: z.string(),
    count: z.number(),
    done: z.boolean(),
    kind: z.enum(['a', 'b']),
    tags: z.array(z.string()),
    note: z.string().nullable(),
    rank: z.number().optional(),
  }),
});

type Thing = z.output<typeof Things.output>;

const { app } = framework({ family: AppUseCase }).collection(Things).build();
const local = createLocalClient(app, {
  context: callContext(),
});

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

/** Rows whose sortability at the type level is not the expected one. */
type TypeDisagreements = {
  [K in keyof Forms as [IsSortable<z.output<Forms[K]['schema']>>] extends [
    Forms[K]['sortable'],
  ]
    ? [Forms[K]['sortable']] extends [IsSortable<z.output<Forms[K]['schema']>>]
      ? never
      : K
    : K]: IsSortable<z.output<Forms[K]['schema']>>;
};

describe('sortable field forms', () => {
  it('every form has its sortability in the type', () => {
    expectTypeOf<keyof TypeDisagreements>().toEqualTypeOf<never>();
  });

  it.each(Object.entries(forms))(
    '%s has its sortability at runtime',
    (_, form) => {
      expect(sortable(form.schema)).toBe(form.sortable);
    },
  );
});

describe('Sort type', () => {
  it('lists the required, non-null string, number and enum fields', () => {
    expectTypeOf<Sort<Thing>[number]>().toEqualTypeOf<
      | 'name'
      | '-name'
      | 'count'
      | '-count'
      | 'kind'
      | '-kind'
      | 'id'
      | '-id'
      | 'createdAt'
      | '-createdAt'
      | 'updatedAt'
      | '-updatedAt'
    >();
  });

  it('types find({ sort }) with no annotation', () => {
    typeOnly(() => local.things.find({ sort: ['-createdAt', 'name'] }));
    typeOnly(() => {
      // @ts-expect-error not a field
      local.things.find({ sort: ['nope'] });
      // @ts-expect-error booleans have no order
      local.things.find({ sort: ['-done'] });
      // @ts-expect-error nullable
      local.things.find({ sort: ['note'] });
      // @ts-expect-error optional
      local.things.find({ sort: ['rank'] });
      // @ts-expect-error arrays have no order
      local.things.find({ sort: ['tags'] });
    });
  });
});

describe('parseSort', () => {
  const paths = (value: unknown) =>
    validationPaths(() => parseSort(Things.output, value));

  it('accepts a valid sort and returns it', () => {
    expect(parseSort(Things.output, ['-createdAt', 'name', 'id'])).toEqual([
      '-createdAt',
      'name',
      'id',
    ]);
    expect(parseSort(Things.output, [])).toEqual([]);
  });

  it('rejects an unknown, unsortable or repeated field with its path', () => {
    expect(paths(['name', 'nope'])).toEqual([[1]]);
    expect(paths(['-done'])).toEqual([[0]]);
    expect(paths(['note'])).toEqual([[0]]);
    expect(paths(['rank'])).toEqual([[0]]);
    expect(paths(['tags'])).toEqual([[0]]);
    expect(paths(['name', '-count', '-name'])).toEqual([[2]]);
    expect(paths('name')).toEqual([[]]);
  });

  it('is the schema ts-pf checks find input with', async () => {
    await expect(
      // @ts-expect-error not a field
      local.things.find({ sort: ['nope'] }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(local.things.find({ limit: 101 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(local.things.find({ limit: 0 })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
