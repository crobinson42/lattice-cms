import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase } from './fixtures/context.js';
import { type Forms, forms } from './fixtures/forms.js';
import { validationPaths } from './fixtures/validation.js';
import { collection, framework, type Where } from './index.js';
import { type KindOf, kindOf, matches, parseWhere } from './where.js';

const Things = collection('things', {
  schema: z.object({
    name: z.string(),
    count: z.number(),
    done: z.boolean(),
    kind: z.enum(['a', 'b']),
    tags: z.array(z.string()),
    meta: z.object({ x: z.number() }),
    note: z.string().nullable().optional(),
  }),
});

type Thing = z.output<typeof Things.output>;

const { app } = framework({ family: AppUseCase }).collection(Things).build();
const local = createLocalClient(app, {
  context: { actor: { userId: 'u1', roles: [] } },
});

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

describe('Where type', () => {
  it('types find({ where }) with no annotation', () => {
    expectTypeOf(local.things.find)
      .parameter(0)
      .toHaveProperty('where')
      .toEqualTypeOf<Where<Thing> | undefined>();
    typeOnly(() =>
      local.things.find({
        where: {
          name: { contains: 'al', ne: 'x' },
          count: { gte: 1, lt: 10, in: [1, 2] },
          done: { eq: true },
          kind: { nin: ['b'] },
          tags: { exists: true },
          meta: { exists: false },
          note: { eq: null },
          createdAt: { gt: '2026-01-01T00:00:00.000Z' },
          or: [{ and: [{ count: { gt: 1 } }, { kind: { eq: 'a' } }] }],
        },
      }),
    );
  });

  it('gives each field kind its operators', () => {
    expectTypeOf<Where<Thing>['count']>().toEqualTypeOf<
      | {
          readonly eq?: number | null;
          readonly ne?: number | null;
          readonly in?: readonly (number | null)[];
          readonly nin?: readonly (number | null)[];
          readonly gt?: number;
          readonly gte?: number;
          readonly lt?: number;
          readonly lte?: number;
          readonly exists?: boolean;
        }
      | undefined
    >();
    expectTypeOf<Where<Thing>['kind']>().toEqualTypeOf<
      | {
          readonly eq?: 'a' | 'b' | null;
          readonly ne?: 'a' | 'b' | null;
          readonly in?: readonly ('a' | 'b' | null)[];
          readonly nin?: readonly ('a' | 'b' | null)[];
          readonly exists?: boolean;
        }
      | undefined
    >();
    expectTypeOf<Where<Thing>['tags']>().toEqualTypeOf<
      { readonly exists?: boolean } | undefined
    >();
  });

  it('rejects what the field does not allow', () => {
    typeOnly(() => {
      local.things.find({
        where: {
          // @ts-expect-error not a field
          nope: { eq: 1 },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error contains is for strings
          count: { contains: '1' },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error booleans are not ordered
          done: { gt: true },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error count is a number
          count: { eq: 'x' },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error arrays take exists only
          tags: { eq: ['x'] },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error c is not a kind
          kind: { in: ['a', 'c'] },
        },
      });
      local.things.find({
        where: {
          // @ts-expect-error enums are not ordered
          kind: { gt: 'a' },
        },
      });
      local.things.find({
        where: {
          and: [
            {
              or: [
                {
                  // @ts-expect-error nested clauses are typed too
                  count: { eq: 'x' },
                },
              ],
            },
          ],
        },
      });
    });
  });
});

/** The paths `parseWhere` reports, or none when the value parses. */
function issues(value: unknown) {
  return validationPaths(() => parseWhere(Things.output, value));
}

describe('parseWhere', () => {
  it('accepts a valid filter and returns it', () => {
    const where = {
      name: { contains: 'al' },
      note: { eq: null },
      and: [{ or: [{ count: { gt: 1 } }] }],
    };
    expect(parseWhere(Things.output, where)).toEqual(where);
  });

  it('rejects each invalid filter with VALIDATION and its path', () => {
    expect(issues({ nope: { eq: 1 } })).toEqual([['nope']]);
    expect(issues({ count: { contains: '1' } })).toEqual([
      ['count', 'contains'],
    ]);
    expect(issues({ done: { gt: true } })).toEqual([['done', 'gt']]);
    expect(issues({ count: { eq: 'x' } })).toEqual([['count', 'eq']]);
    expect(issues({ tags: { eq: ['x'] } })).toEqual([['tags', 'eq']]);
    expect(issues({ kind: { in: ['a', 'c'] } })).toEqual([['kind', 'in', 1]]);
    expect(issues({ and: [] })).toEqual([['and']]);
    expect(issues({ or: [] })).toEqual([['or']]);
    expect(issues({ and: [{ or: [{ count: { eq: 'x' } }] }] })).toEqual([
      ['and', 0, 'or', 0, 'count', 'eq'],
    ]);
  });

  it('is the schema ts-pf checks find input with', async () => {
    await expect(
      local.things.find({
        where: {
          // @ts-expect-error not a field
          nope: { eq: 1 },
        },
      }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

/** Checks the filter against Thing, then matches. */
function match(doc: Readonly<Record<string, unknown>>, where: Where<Thing>) {
  return matches(doc, where);
}

const doc = {
  name: 'Alpha',
  count: 5,
  done: true,
  kind: 'a',
  tags: ['x'],
  meta: { x: 1 },
  note: 'Hello World',
  createdAt: '2026-01-02T00:00:00.000Z',
};
const nullNote = { ...doc, note: null };
const { note: _, ...missingNote } = doc;

describe('matches', () => {
  it('eq', () => {
    expect(match(doc, { name: { eq: 'Alpha' } })).toBe(true);
    expect(match(doc, { name: { eq: 'Beta' } })).toBe(false);
    expect(match(doc, { count: { eq: 5 } })).toBe(true);
    expect(match(doc, { done: { eq: false } })).toBe(false);
    expect(match(doc, { kind: { eq: 'a' } })).toBe(true);
  });

  it('eq: null matches null or missing', () => {
    expect(match(nullNote, { note: { eq: null } })).toBe(true);
    expect(match(missingNote, { note: { eq: null } })).toBe(true);
    expect(match(doc, { note: { eq: null } })).toBe(false);
  });

  it('ne matches a missing field; ne: null does not match null or missing', () => {
    expect(match(doc, { name: { ne: 'Beta' } })).toBe(true);
    expect(match(doc, { name: { ne: 'Alpha' } })).toBe(false);
    expect(match(missingNote, { note: { ne: 'x' } })).toBe(true);
    expect(match(nullNote, { note: { ne: 'x' } })).toBe(true);
    expect(match(nullNote, { note: { ne: null } })).toBe(false);
    expect(match(missingNote, { note: { ne: null } })).toBe(false);
    expect(match(doc, { note: { ne: null } })).toBe(true);
  });

  it('in', () => {
    expect(match(doc, { count: { in: [1, 5] } })).toBe(true);
    expect(match(doc, { count: { in: [1, 2] } })).toBe(false);
    expect(match(missingNote, { note: { in: ['x', null] } })).toBe(true);
    expect(match(missingNote, { note: { in: ['x'] } })).toBe(false);
  });

  it('nin matches a missing field', () => {
    expect(match(doc, { kind: { nin: ['b'] } })).toBe(true);
    expect(match(doc, { kind: { nin: ['a'] } })).toBe(false);
    expect(match(missingNote, { note: { nin: ['x'] } })).toBe(true);
    expect(match(missingNote, { note: { nin: [null] } })).toBe(false);
  });

  it('gt, gte, lt and lte on numbers', () => {
    expect(match(doc, { count: { gt: 4 } })).toBe(true);
    expect(match(doc, { count: { gt: 5 } })).toBe(false);
    expect(match(doc, { count: { gte: 5 } })).toBe(true);
    expect(match(doc, { count: { lt: 5 } })).toBe(false);
    expect(match(doc, { count: { lte: 5 } })).toBe(true);
  });

  it('gt, gte, lt and lte on strings order by code unit', () => {
    expect(match(doc, { createdAt: { gt: '2026-01-01T23:59:59.999Z' } })).toBe(
      true,
    );
    expect(match(doc, { createdAt: { lt: '2026-01-02T00:00:00.001Z' } })).toBe(
      true,
    );
    expect(match(doc, { createdAt: { gte: '2026-01-03T00:00:00.000Z' } })).toBe(
      false,
    );
    expect(match(doc, { name: { lte: 'Alpha' } })).toBe(true);
    expect(match(doc, { name: { lt: 'alpha' } })).toBe(true);
  });

  it('a comparison with null or missing is false', () => {
    expect(match(nullNote, { note: { gt: '' } })).toBe(false);
    expect(match(missingNote, { note: { lte: 'z' } })).toBe(false);
  });

  it('contains is a case-insensitive literal substring', () => {
    expect(match(doc, { note: { contains: 'lo wo' } })).toBe(true);
    expect(match(doc, { note: { contains: 'HELLO' } })).toBe(true);
    expect(match(doc, { note: { contains: 'l.o' } })).toBe(false);
    expect(match({ ...doc, note: 'a.*b' }, { note: { contains: '.*' } })).toBe(
      true,
    );
    expect(match(missingNote, { note: { contains: '' } })).toBe(false);
  });

  it('exists asks whether the field has a value', () => {
    expect(match(doc, { note: { exists: true } })).toBe(true);
    expect(match(nullNote, { note: { exists: true } })).toBe(false);
    expect(match(missingNote, { note: { exists: true } })).toBe(false);
    expect(match(nullNote, { note: { exists: false } })).toBe(true);
    expect(match(missingNote, { note: { exists: false } })).toBe(true);
    expect(match(doc, { tags: { exists: true }, meta: { exists: true } })).toBe(
      true,
    );
  });

  it('several fields, or several operators on one field, all have to match', () => {
    expect(match(doc, { name: { eq: 'Alpha' }, count: { gt: 1 } })).toBe(true);
    expect(match(doc, { name: { eq: 'Alpha' }, count: { gt: 9 } })).toBe(false);
    expect(match(doc, { count: { gt: 1, lt: 9 } })).toBe(true);
    expect(match(doc, { count: { gt: 1, lt: 3 } })).toBe(false);
  });

  it('and, or and nesting', () => {
    expect(
      match(doc, { and: [{ count: { gt: 1 } }, { kind: { eq: 'a' } }] }),
    ).toBe(true);
    expect(
      match(doc, { and: [{ count: { gt: 1 } }, { kind: { eq: 'b' } }] }),
    ).toBe(false);
    expect(
      match(doc, { or: [{ count: { gt: 9 } }, { kind: { eq: 'a' } }] }),
    ).toBe(true);
    expect(
      match(doc, { or: [{ count: { gt: 9 } }, { kind: { eq: 'b' } }] }),
    ).toBe(false);
    expect(
      match(doc, {
        or: [
          { count: { gt: 9 } },
          {
            and: [{ done: { eq: true } }, { or: [{ name: { eq: 'Alpha' } }] }],
          },
        ],
      }),
    ).toBe(true);
    expect(
      match(doc, {
        name: { eq: 'Alpha' },
        or: [{ count: { gt: 9 } }, { kind: { eq: 'b' } }],
      }),
    ).toBe(false);
  });
});

/** Rows whose kind at the type level is not the expected kind. */
type TypeDisagreements = {
  [K in keyof Forms as [KindOf<z.output<Forms[K]['schema']>>] extends [
    Forms[K]['kind'],
  ]
    ? [Forms[K]['kind']] extends [KindOf<z.output<Forms[K]['schema']>>]
      ? never
      : K
    : K]: KindOf<z.output<Forms[K]['schema']>>;
};

describe('field kinds', () => {
  it('every form has its kind in the type', () => {
    expectTypeOf<keyof TypeDisagreements>().toEqualTypeOf<never>();
  });

  it.each(Object.entries(forms))('%s has its kind at runtime', (_, form) => {
    expect(kindOf(form.schema)).toBe(form.kind);
  });

  it('accepts at runtime what each form allows in the type', () => {
    const Forms = collection('forms', {
      schema: z.object({
        literalUnion: forms.literalUnion.schema,
        templateLiteral: forms.templateLiteral.schema,
        brandedString: forms.brandedString.schema,
        catch: forms.catch.schema,
        readonly: forms.readonly.schema,
        booleanLiteral: forms.booleanLiteral.schema,
        nonoptional: forms.nonoptional.schema,
        prefault: forms.prefault.schema,
      }),
    });
    const where: Where<z.output<typeof Forms.output>> = {
      literalUnion: { in: ['a', null] },
      templateLiteral: { eq: 'id-5' },
      brandedString: { contains: 'x', exists: true },
      catch: { gt: 1, lte: 9 },
      readonly: { ne: 'a' },
      booleanLiteral: { eq: true },
      nonoptional: { gte: 'a' },
      prefault: { lt: 'z' },
    };
    expect(parseWhere(Forms.output, where)).toEqual(where);
    expect(() =>
      parseWhere(Forms.output, { templateLiteral: { eq: 'nope' } }),
    ).toThrow(LatticeError);
    expect(() => parseWhere(Forms.output, { catch: { eq: 'x' } })).toThrow(
      LatticeError,
    );
  });
});
