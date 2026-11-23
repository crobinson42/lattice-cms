import { z } from 'zod';
import { refusedSort } from './describe.js';
import { invalid, LatticeError } from './errors.js';
import { markOf } from './marker.js';
import {
  type AnyWhere,
  compare,
  type KindOf,
  kindOf,
  nullish,
} from './where.js';

/** The generated find's sort when the caller gives none. */
export const defaultSort = ['-createdAt'] as const;
/** The generated find's page size when the caller gives none. */
export const defaultLimit = 20;
export const maxLimit = 100;

// Booleans have no useful order, and 'other' fields none at all.
const sortableKinds = ['string', 'number', 'enum'] as const;

/**
 * Whether a field can be sorted: never null or missing, so a cursor
 * predicate never meets null, and of an ordered kind. Mirrors `sortable`.
 */
export type IsSortable<V> = null extends V
  ? false
  : undefined extends V
    ? false
    : KindOf<V> extends (typeof sortableKinds)[number]
      ? true
      : false;

/** Whether a field can be sorted, from its schema. Mirrors `IsSortable`. */
export function sortable(schema: z.core.$ZodType): boolean {
  const kind = kindOf(schema);
  return !nullish(schema) && sortableKinds.some((k) => k === kind);
}

type SortableField<Doc> = {
  [K in keyof Doc & string]: IsSortable<Doc[K]> extends true ? K : never;
}[keyof Doc & string];

/** A field to order by: `field` ascends, `-field` descends. */
export type SortKey<Doc> = SortableField<Doc> | `-${SortableField<Doc>}`;

/**
 * The fields to order by, first key first. An array, not an object: Zod
 * rebuilds object keys in shape order, which would reorder the priority.
 */
export type Sort<Doc> = readonly SortKey<Doc>[];

/**
 * The validator of find's `Sort` on documents of `schema`, which gives
 * `defaultSort` when the caller sends none. The overload states its static
 * type, and that `defaultSort` is a valid `Sort` for every collection: it
 * names a system field, which a generic shape cannot show. The
 * implementation checks field names it reads from the shape at runtime,
 * which a loop cannot express as a mapped type.
 */
export function sortSchema<S extends z.ZodObject>(
  schema: S,
): z.ZodDefault<z.ZodType<Sort<z.output<S>>, Sort<z.output<S>>>>;
export function sortSchema(schema: z.ZodObject): z.ZodType {
  const fields = new Map(
    Object.entries(schema.shape).map(([name, field]) => [
      name,
      sortable(field),
    ]),
  );
  // Only a field that can be sorted at all is refused for being withheld.
  const maskable = Object.entries(schema.shape)
    .filter(([, field]) => markOf(field) !== undefined && sortable(field))
    .map(([name]) => name);
  const sort = z
    .array(z.string())
    .superRefine((keys, ctx) => {
      const seen = new Set<string>();
      keys.forEach((key, index) => {
        const { field } = keyOf(key);
        const canSort = fields.get(field);
        if (canSort === undefined) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `"${field}" is not a field`,
          });
        } else if (!canSort) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `"${field}" cannot be sorted: it is optional, nullable, or not a string, number or enum`,
          });
        }
        if (seen.has(field)) {
          ctx.addIssue({
            code: 'custom',
            path: [index],
            message: `"${field}" is sorted twice`,
          });
        }
        seen.add(field);
      });
    })
    .default(() => [...defaultSort]);
  // As on where: the description says a sort on a maskable field may be refused.
  return maskable.length === 0 ? sort : sort.describe(refusedSort(maskable));
}

/** Parses a `Sort` on documents of `schema`, or throws `VALIDATION` naming each path. */
export function parseSort<S extends z.ZodObject>(
  schema: S,
  value: unknown,
): Sort<z.output<S>> {
  const result = sortSchema(schema).safeParse(value);
  if (result.success) return result.data;
  throw invalid(result.error.issues);
}

type OrderKey = { readonly field: string; readonly direction: 1 | -1 };

/** A sort as stores apply it: keys in priority order, ending with `id`. */
export type Order = readonly OrderKey[];

function keyOf(key: string): OrderKey {
  return key.startsWith('-')
    ? { field: key.slice(1), direction: -1 }
    : { field: key, direction: 1 };
}

/** The order a sort means. `id` is the last tiebreak unless the sort has it. */
export function orderOf(sort: readonly string[]): Order {
  const keys = sort.map(keyOf);
  return keys.some((key) => key.field === 'id')
    ? keys
    : [...keys, { field: 'id', direction: 1 }];
}

function keysOf(order: Order): string[] {
  return order.map((key) =>
    key.direction === 1 ? key.field : `-${key.field}`,
  );
}

/** Orders documents by `order`. Values compare as `Where` comparisons do. */
export function compareDocs(order: Order) {
  return (
    a: Readonly<Record<string, unknown>>,
    b: Readonly<Record<string, unknown>>,
  ): number => {
    for (const key of order) {
      const result = compare(a[key.field], b[key.field]) ?? 0;
      if (result !== 0) return result * key.direction;
    }
    return 0;
  };
}

const cursorSchema = z.object({
  sort: z.array(z.string()),
  values: z.array(z.union([z.string(), z.number()])),
});

/** An opaque cursor that starts the next page after `doc`. */
export function encodeCursor(
  order: Order,
  doc: Readonly<Record<string, unknown>>,
): string {
  const cursor = {
    sort: keysOf(order),
    values: order.map((key) => doc[key.field]),
  };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function badCursor(message: string) {
  return LatticeError.VALIDATION({ issues: [{ path: ['after'], message }] });
}

function readCursor(cursor: string): unknown {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badCursor('The cursor is malformed');
  }
}

/**
 * The keyset filter for the documents after `cursor` under `order`: the
 * tuple of sort values comes after the cursor's, key by key, in each key's
 * direction. It is a `Where`, so every store applies it as it applies any
 * filter, and sort fields are never null, so no key meets a missing value.
 */
export function after(order: Order, cursor: string): AnyWhere {
  const parsed = cursorSchema.safeParse(readCursor(cursor));
  if (!parsed.success) throw badCursor('The cursor is malformed');
  const { sort, values } = parsed.data;
  if (sort.join(',') !== keysOf(order).join(',')) {
    throw badCursor('The cursor is for a different sort');
  }
  if (values.length !== order.length) {
    throw badCursor('The cursor is malformed');
  }
  const clauses: AnyWhere[] = [];
  const equal: Record<string, { readonly eq: string | number }> = {};
  order.forEach(({ field, direction }, index) => {
    const value = values[index];
    if (value === undefined) throw badCursor('The cursor is malformed');
    clauses.push({
      ...equal,
      [field]: direction === 1 ? { gt: value } : { lt: value },
    });
    equal[field] = { eq: value };
  });
  return { or: clauses };
}
