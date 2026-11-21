import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { collection } from './index.js';

describe('collection()', () => {
  it('rejects field names that collide, at compile time and at runtime', () => {
    expect(() =>
      // @ts-expect-error id is a system field
      collection('a', { schema: z.object({ id: z.string() }) }),
    ).toThrow('"id" is a reserved field name');
    expect(() =>
      // @ts-expect-error createdAt is a system field
      collection('a', { schema: z.object({ createdAt: z.string() }) }),
    ).toThrow('"createdAt" is a reserved field name');
    expect(() =>
      // @ts-expect-error updatedAt is a system field
      collection('a', { schema: z.object({ updatedAt: z.string() }) }),
    ).toThrow('"updatedAt" is a reserved field name');
    expect(() =>
      // @ts-expect-error and combines filters
      collection('a', { schema: z.object({ and: z.string() }) }),
    ).toThrow('"and" is a reserved field name');
    expect(() =>
      // @ts-expect-error or combines filters
      collection('a', { schema: z.object({ or: z.string() }) }),
    ).toThrow('"or" is a reserved field name');
  });

  it('rejects names a store would misread, at compile time and at runtime', () => {
    const invalid =
      'is not a valid field name: it contains ".", starts with "$" or is "_id"';
    expect(() =>
      // @ts-expect-error a dot reads as a path
      collection('a', { schema: z.object({ 'a.b': z.string() }) }),
    ).toThrow(`"a.b" ${invalid}`);
    expect(() =>
      // @ts-expect-error a leading $ reads as an operator
      collection('a', { schema: z.object({ $set: z.string() }) }),
    ).toThrow(`"$set" ${invalid}`);
    expect(() =>
      // @ts-expect-error _id is where a store keeps id
      collection('a', { schema: z.object({ _id: z.string() }) }),
    ).toThrow(`"_id" ${invalid}`);
    expect(() =>
      // @ts-expect-error the tenant field follows the same rule
      collection('a', {
        schema: z.object({ name: z.string() }),
        tenant: 'org.id',
      }),
    ).toThrow('tenant "org.id" is stamped by Lattice');
    // A $ after the first character, or _id inside a name, is fine.
    expect(
      collection('a', {
        schema: z.object({ price$: z.number(), a_id: z.string() }),
      }).slug,
    ).toBe('a');
  });
});

describe('collection() field forms', () => {
  it('rejects a Date, at the top level also at compile time', () => {
    expect(() =>
      // @ts-expect-error a Date reaches HTTP clients as a string
      collection('a', { schema: z.object({ at: z.date() }) }),
    ).toThrow(
      'Lattice: "a.at" is a Date; store an ISO string (z.iso.datetime())',
    );
    expect(() =>
      // @ts-expect-error an optional Date too
      collection('a', { schema: z.object({ at: z.date().optional() }) }),
    ).toThrow('"a.at" is a Date');
    expect(() =>
      collection('a', {
        schema: z.object({ meta: z.object({ at: z.date() }) }),
      }),
    ).toThrow(
      'Lattice: "a.meta.at" is a Date; store an ISO string (z.iso.datetime())',
    );
    expect(() =>
      collection('a', { schema: z.object({ log: z.array(z.date()) }) }),
    ).toThrow('"a.log[]" is a Date');
  });

  it('rejects a transform anywhere', () => {
    expect(() =>
      collection('a', {
        schema: z.object({ title: z.string().transform((s) => s.trim()) }),
      }),
    ).toThrow('Lattice: "a.title" has a transform; use a beforeChange hook');
    expect(() =>
      collection('a', {
        schema: z.object({
          meta: z
            .object({ n: z.string().pipe(z.coerce.number()).optional() })
            .nullable(),
        }),
      }),
    ).toThrow('Lattice: "a.meta.n" has a transform; use a beforeChange hook');
    expect(() =>
      collection('a', {
        schema: z.object({
          tag: z.union([z.literal('a'), z.preprocess(String, z.string())]),
        }),
      }),
    ).toThrow('"a.tag" has a transform');
  });
});
