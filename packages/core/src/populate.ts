import { z } from 'zod';
import type { AnyCollection, AnyRelation } from './collection.js';

/**
 * A populated document the caller may not read, or one that no longer
 * exists: its id only (0022). A UI can still show the row.
 */
const withheld = z.object({ id: z.string() });

export type Withheld = z.output<typeof withheld>;

/** The `populate` input field for `keys`, or no field when there are none. */
export function populateShape(keys: readonly string[]): z.core.$ZodShape {
  const [first, ...rest] = keys;
  return first === undefined
    ? {}
    : { populate: z.array(z.enum([first, ...rest])).optional() };
}

/**
 * What `populate` may name on a read of `collection`: its ref fields, and
 * on `get` its `many()` relations. `find` populates refs only, so a page
 * cannot fetch up to 1000 links for each of its documents.
 */
export function populateKeys(
  collection: AnyCollection,
  read: 'get' | 'find',
): string[] {
  return [
    ...collection.refs.map((ref) => ref.field),
    ...(read === 'get' ? Object.keys(collection.relations) : []),
  ];
}

/** The fields a link of `relation` carries, beside its two refs. */
export function linkFields(relation: AnyRelation): string[] {
  return Object.keys(relation.through.schema.shape).filter(
    (field) => field !== relation.parentField && field !== relation.targetField,
  );
}

/**
 * The schemas of a populated read of `collection`, by the output schema of
 * each collection: `fields` holds each ref field's expanded schema (its
 * target document or `Withheld`, element-wise for a list of ids), and `wide`
 * is the document as a read sends it, with each ref field plain or expanded.
 */
export function expansionOf(
  collection: AnyCollection,
  outputs: ReadonlyMap<string, z.ZodType>,
  read: 'get' | 'find',
): {
  readonly fields: Readonly<Record<string, z.ZodType>>;
  readonly wide: z.ZodObject;
} {
  const fields: Record<string, z.ZodType> = {};
  const wide: Record<string, z.ZodType> = {};
  const targetOf = (slug: string) => {
    const target = outputs.get(slug);
    if (target === undefined) {
      throw new Error(
        `Lattice: "${slug}" is not a collection of this framework, so ${collection.slug} cannot populate it`,
      );
    }
    return z.union([target, withheld]);
  };
  for (const { field, slug, array } of collection.refs) {
    const one = targetOf(slug);
    const plain = collection.output.shape[field];
    if (plain === undefined) {
      throw new Error(`Lattice: ${collection.slug} has no field "${field}"`);
    }
    const expanded = array ? z.array(one) : one;
    fields[field] = expanded;
    wide[field] = z.union([plain, expanded]);
  }
  if (read === 'get') {
    // A relation is in the output only when populated: its links, each
    // with its fields and its target document.
    for (const [name, relation] of Object.entries(collection.relations)) {
      const { shape } = relation.through.output;
      const link = z.object({
        ...Object.fromEntries(
          linkFields(relation).flatMap((field) => {
            const schema = shape[field];
            return schema === undefined ? [] : [[field, schema]];
          }),
        ),
        doc: targetOf(relation.target),
      });
      fields[name] = z.array(link);
      wide[name] = z.array(link).optional();
    }
  }
  return { fields, wide: collection.output.extend(wide) };
}
