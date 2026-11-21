import { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { innerOf } from './where.js';

/**
 * What happens to the documents that refer to one being deleted:
 * `restrict` refuses the delete, `cascade` deletes them too, and `nullify`
 * clears the reference (0028).
 */
export type OnDelete = 'restrict' | 'cascade' | 'nullify';

/** A reference as Lattice reads it: the target collection's slug and its onDelete. */
type RefInfo<Slug extends string = string, D extends OnDelete = OnDelete> = {
  readonly slug: Slug;
  readonly onDelete: D;
};

/**
 * A string field that holds the id of a document in collection `Slug`.
 * `'~ref'` is a type-only brand; at runtime the reference is a no-op check,
 * so a clone such as `.min(1)` keeps it.
 */
export type Ref<Slug extends string, D extends OnDelete> = z.ZodString & {
  readonly '~ref'?: RefInfo<Slug, D>;
};

/** The check that carries a reference. It accepts every value. */
type RefMarker = z.core.$ZodCheck<string> & { readonly '~lattice': RefInfo };

function isMarker(check: unknown): check is RefMarker {
  return typeof check === 'object' && check !== null && '~lattice' in check;
}

/**
 * Marks a string field as the id of a document in collection `slug`. The
 * slug, not the collection, so collections can refer to each other.
 * `z.array(ref(slug))` is a list of ids.
 */
export function ref<
  const Slug extends string,
  const D extends OnDelete = 'restrict',
>(slug: Slug, options?: { readonly onDelete?: D }): Ref<Slug, D> {
  const info: RefInfo = { slug, onDelete: options?.onDelete ?? 'restrict' };
  const marker: RefMarker = Object.assign(
    z.check<string>(() => {}),
    { '~lattice': info },
  );
  return z.string().check(marker);
}

// ---------------------------------------------------------------- many

/** What deleting a target does to its links: refuse, or delete them. */
export type ManyOnDelete = 'restrict' | 'cascade';

/** A many-to-many relation, through a join collection Lattice derives. */
export type Many<
  Target extends string,
  Through extends string,
  Fields extends z.core.$ZodShape,
  D extends ManyOnDelete,
> = {
  readonly kind: 'many';
  readonly target: Target;
  /** The join collection's slug. */
  readonly through: Through;
  /** Fields each link carries, such as `sortOrder`. */
  readonly fields: z.ZodObject<Fields, z.core.$strip> | undefined;
  /** What deleting a target does to its links. Undefined is restrict. */
  readonly onDelete: D | undefined;
};

export type AnyMany = Many<string, string, z.core.$ZodShape, ManyOnDelete>;

/**
 * Relates each document to many of `target`, through a join collection
 * `through` with `<parent>Id`, `<target>Id` and `fields`. Lattice derives
 * that collection; its slug is `through`.
 */
export function many<
  const Target extends string,
  const Through extends string,
  Fields extends z.core.$ZodShape = Record<never, never>,
  const D extends ManyOnDelete = 'restrict',
>(
  target: Target,
  options: {
    readonly through: Through;
    readonly fields?: z.ZodObject<Fields, z.core.$strip>;
    readonly onDelete?: D;
  },
): Many<Target, Through, Fields, D> {
  return {
    kind: 'many',
    target,
    through: options.through,
    fields: options.fields,
    onDelete: options.onDelete,
  };
}

/** The join collection's shape: the two refs, then the link fields. */
export type JoinShape<
  P extends string,
  T extends string,
  D extends ManyOnDelete,
  F extends z.core.$ZodShape,
> = {
  [K in `${P}Id` | `${T}Id` | keyof F]: K extends `${P}Id`
    ? Ref<P, 'cascade'>
    : K extends `${T}Id`
      ? Ref<T, D>
      : F[K];
};

/** What `set` takes per link: the target's id and the link fields. */
export type LinkShape<
  T extends string,
  D extends ManyOnDelete,
  F extends z.core.$ZodShape,
> = {
  [K in `${T}Id` | keyof F]: K extends `${T}Id` ? Ref<T, D> : F[K];
};

/**
 * The join collection's schema, and the link schema `set` takes. Untyped:
 * `relationsOf` in collection.ts states their types.
 */
export function joinSchemas(
  parent: string,
  relation: AnyMany,
): {
  readonly join: z.ZodObject<z.core.$ZodShape, z.core.$strip>;
  readonly link: z.ZodObject<z.core.$ZodShape, z.core.$strip>;
  readonly parentField: string;
  readonly targetField: string;
} {
  const parentField = `${parent}Id`;
  const targetField = `${relation.target}Id`;
  const fields = relation.fields?.shape ?? {};
  const target = {
    [targetField]: ref(relation.target, {
      onDelete: relation.onDelete ?? 'restrict',
    }),
  };
  return {
    join: z.object({
      [parentField]: ref(parent, { onDelete: 'cascade' }),
      ...target,
      ...fields,
    }),
    link: z.object({ ...target, ...fields }),
    parentField,
    targetField,
  };
}

// ---------------------------------------------------------------- types

/** The reference a field schema holds, through optional, nullable, default and array. */
type RefIn<F> = F extends { readonly '~ref'?: infer R extends RefInfo }
  ? R
  : F extends
        | z.ZodOptional<infer I>
        | z.ZodNullable<infer I>
        | z.ZodDefault<infer I>
        | z.ZodArray<infer I>
    ? RefIn<I>
    : never;

/** Each ref field of `Shape`, and the slug it refers to. */
export type RefSlugs<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape as [RefIn<Shape[K]>] extends [never] ? never : K]: RefIn<
    Shape[K]
  >['slug'];
};

/** The fields of `Shape` whose ref cascades. */
export type CascadeFields<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape]: [RefIn<Shape[K]>] extends [never]
    ? never
    : RefIn<Shape[K]>['onDelete'] extends 'cascade'
      ? K
      : never;
}[keyof Shape];

/** A field whose own schema is a ref with `nullify`: nothing wraps it optional or nullable. */
type RequiredNullify<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape]: Shape[K] extends {
    readonly '~ref'?: RefInfo<string, 'nullify'>;
  }
    ? K
    : never;
}[keyof Shape];

/** A list of ids, possibly wrapped, with `cascade`. */
type ArrayCascade<F> =
  F extends z.ZodArray<infer I>
    ? [RefIn<I>] extends [never]
      ? false
      : RefIn<I>['onDelete'] extends 'cascade'
        ? true
        : false
    : F extends
          | z.ZodOptional<infer I>
          | z.ZodNullable<infer I>
          | z.ZodDefault<infer I>
      ? ArrayCascade<I>
      : false;

type CascadeArrays<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape]: ArrayCascade<Shape[K]> extends true ? K : never;
}[keyof Shape];

/**
 * The definition-time rules of refs. A rejected schema adds a key the
 * options lack, so the error names the field.
 */
export type RefCheck<Shape extends z.core.$ZodShape> = [
  RequiredNullify<Shape>,
] extends [never]
  ? [CascadeArrays<Shape>] extends [never]
    ? unknown
    : {
        readonly '~error': `"${CascadeArrays<Shape> & string}" is a list of ids; it cannot cascade (use restrict or nullify)`;
      }
  : {
      readonly '~error': `"${RequiredNullify<Shape> & string}" is required; nullify needs it .optional() or .nullable()`;
    };

// ---------------------------------------------------------------- runtime

/** One ref field of a collection, as the generated delete reads it. */
export type RefField = {
  readonly field: string;
  readonly slug: string;
  readonly onDelete: OnDelete;
  /** A list of ids: nullify pulls the id, and a lookup uses `has`. */
  readonly array: boolean;
  /** What nullify writes: undefined to unset, or null. */
  readonly cleared: null | undefined;
};

/** The ref a field schema holds, unwrapping as `RefIn` does. */
function refIn(
  schema: z.core.$ZodType,
):
  | { info: RefInfo; array: boolean; optional: boolean; nullable: boolean }
  | undefined {
  let current = schema;
  let optional = false;
  let nullable = false;
  let array = false;
  for (;;) {
    if (current instanceof z.core.$ZodOptional) optional = true;
    if (current instanceof z.core.$ZodNullable) nullable = true;
    const inner = innerOf(current);
    if (inner !== undefined) {
      current = inner;
      continue;
    }
    if (current instanceof z.core.$ZodArray && !array) {
      array = true;
      current = current._zod.def.element;
      continue;
    }
    break;
  }
  const marker = (current._zod.def.checks ?? []).find(isMarker);
  return marker === undefined
    ? undefined
    : { info: marker['~lattice'], array, optional, nullable };
}

/**
 * The ref fields of a schema. Throws on the rules `RefCheck` states, for
 * the forms the types do not catch.
 */
export function refsOf(slug: string, shape: z.core.$ZodShape): RefField[] {
  const refs: RefField[] = [];
  for (const [field, schema] of Object.entries(shape)) {
    const found = refIn(schema);
    if (found === undefined) continue;
    const { info, array, optional, nullable } = found;
    if (array && info.onDelete === 'cascade') {
      throw new Error(
        `Lattice: "${slug}.${field}" is a list of ids; it cannot cascade (use restrict or nullify)`,
      );
    }
    if (!array && info.onDelete === 'nullify' && !optional && !nullable) {
      throw new Error(
        `Lattice: "${slug}.${field}" is required; nullify needs it .optional() or .nullable()`,
      );
    }
    refs.push({
      field,
      slug: info.slug,
      onDelete: info.onDelete,
      array,
      cleared: optional ? undefined : null,
    });
  }
  return refs;
}

/** A collection that refers to another one, through one of its ref fields. */
export type Referrer = {
  readonly collection: AnyCollection;
  readonly ref: RefField;
};

/** The referrers of each collection, by its slug. */
export type Referrers = ReadonlyMap<string, readonly Referrer[]>;

/** Who refers to each collection among `collections`. */
export function referrersOf(collections: readonly AnyCollection[]): Referrers {
  const referrers = new Map<string, Referrer[]>();
  for (const collection of collections) {
    for (const ref of collection.refs) {
      const list = referrers.get(ref.slug) ?? [];
      list.push({ collection, ref });
      referrers.set(ref.slug, list);
    }
  }
  return referrers;
}
