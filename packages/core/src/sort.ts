import { z } from 'zod';
import { refusedSort } from './describe.js';
import { invalid, LatticeError } from './errors.js';
import { markOf } from './marker.js';
import {
  type AnyWhere,
  compare,
  type FieldOps,
  type KindOf,
  kindOf,
} from './where.js';

/** The generated find's sort when the caller gives none. */
export const defaultSort = ['-createdAt'] as const;
/** The generated find's page size when the caller gives none. */
export const defaultLimit = 20;
export const maxLimit = 100;

// Booleans have no useful order, and 'other' fields none at all.
const sortableKinds = ['string', 'number', 'enum'] as const;

/**
 * Whether a field can be sorted: of an ordered kind. An optional or
 * nullable one sorts too, with its missing values last (0037). Mirrors
 * `sortable`.
 */
export type IsSortable<V> =
  KindOf<V> extends (typeof sortableKinds)[number] ? true : false;

/** Whether a field can be sorted, from its schema. Mirrors `IsSortable`. */
export function sortable(schema: z.core.$ZodType): boolean {
  const kind = kindOf(schema);
  return sortableKinds.some((k) => k === kind);
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
 * implementation lists the keys it reads from the shape at runtime, which a
 * loop cannot express as a mapped type.
 *
 * Each key is an enum of the sortable fields, ascending and descending, so
 * the JSON Schema shows a client every valid key. The enum's error names
 * why a key is refused: not a field, or a field that cannot be sorted.
 */
export function sortSchema<S extends z.ZodObject>(
  schema: S,
): z.ZodDefault<z.ZodType<Sort<z.output<S>>, Sort<z.output<S>>>>;
export function sortSchema(schema: z.ZodObject): z.ZodType {
  const fields = Object.entries(schema.shape);
  const keys = fields
    .filter(([, field]) => sortable(field))
    .flatMap(([name]) => [name, `-${name}`]);
  // Only a field that can be sorted at all is refused for being withheld.
  const maskable = fields
    .filter(([, field]) => markOf(field) !== undefined && sortable(field))
    .map(([name]) => name);
  const key = z.enum(keys, {
    // A non-string key gets Zod's own message.
    error: ({ input }) => {
      if (typeof input !== 'string') return undefined;
      const { field } = keyOf(input);
      return fields.some(([name]) => name === field)
        ? `"${field}" cannot be sorted: it is not a string, number or enum`
        : `"${field}" is not a field`;
    },
  });
  const sort = z
    .array(key)
    .superRefine((given, ctx) => {
      const seen = new Set<string>();
      given.forEach((value, index) => {
        const { field } = keyOf(value);
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

type OrderKey = {
  readonly field: string;
  readonly direction: 1 | -1;
  /** Whether a document may have no value here: it then sorts last. */
  readonly optional: boolean;
};

/** A sort as stores apply it: keys in priority order, ending with `id`. */
export type Order = readonly OrderKey[];

/** The field a sort key names, and its direction. */
export function keyOf(key: string): { field: string; direction: 1 | -1 } {
  return key.startsWith('-')
    ? { field: key.slice(1), direction: -1 }
    : { field: key, direction: 1 };
}

/**
 * The order a sort means. `id` is the last tiebreak unless the sort has
 * it. `optional` names the sort fields a document may lack.
 */
export function orderOf(
  sort: readonly string[],
  optional: readonly string[],
): Order {
  const keys = sort.map((key) => {
    const { field, direction } = keyOf(key);
    return { field, direction, optional: optional.includes(field) };
  });
  return keys.some((key) => key.field === 'id')
    ? keys
    : [...keys, { field: 'id', direction: 1, optional: false }];
}

function keysOf(order: Order): string[] {
  return order.map((key) =>
    key.direction === 1 ? key.field : `-${key.field}`,
  );
}

/** The value of `field` in `doc`, null when it has none. */
function sortValue(
  doc: Readonly<Record<string, unknown>>,
  field: string,
): unknown {
  return doc[field] ?? null;
}

/**
 * Orders documents by `order`. Values compare as `Where` comparisons do. On
 * an optional key, a missing value comes after every value, in either
 * direction, and two missing values tie, so the next key decides (0037). A
 * required key compares as before, so an old row that lacks it ties.
 */
export function compareDocs(order: Order) {
  return (
    a: Readonly<Record<string, unknown>>,
    b: Readonly<Record<string, unknown>>,
  ): number => {
    for (const key of order) {
      const x = sortValue(a, key.field);
      const y = sortValue(b, key.field);
      if (key.optional && (x === null || y === null)) {
        if (x === y) continue;
        return x === null ? 1 : -1;
      }
      const result = compare(x, y) ?? 0;
      if (result !== 0) return result * key.direction;
    }
    return 0;
  };
}

// A missing value is null: JSON has no undefined.
const cursorSchema = z.object({
  sort: z.array(z.string()),
  values: z.array(z.union([z.string(), z.number(), z.null()])),
});

/** An opaque cursor that starts the next page after `doc`. */
export function encodeCursor(
  order: Order,
  doc: Readonly<Record<string, unknown>>,
): string {
  const cursor = {
    sort: keysOf(order),
    values: order.map((key) => sortValue(doc, key.field)),
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
 * The sort values `cursor` holds under `order`, one per key, null where its
 * document had none. Throws VALIDATION at `after` for a malformed cursor,
 * one from another sort, or a null on a required key.
 */
export function cursorValues(
  order: Order,
  cursor: string,
): readonly (string | number | null)[] {
  const parsed = cursorSchema.safeParse(readCursor(cursor));
  if (!parsed.success) throw badCursor('The cursor is malformed');
  const { sort, values } = parsed.data;
  if (sort.join(',') !== keysOf(order).join(',')) {
    throw badCursor('The cursor is for a different sort');
  }
  if (
    values.length !== order.length ||
    order.some((key, index) => values[index] === null && !key.optional)
  ) {
    throw badCursor('The cursor is malformed');
  }
  return values;
}

/**
 * The keyset filter for the documents after `cursor` under `order`: the
 * tuple of sort values comes after the cursor's, key by key, in each key's
 * direction. It is a `Where`, so every store applies it as it applies any
 * filter. A missing value comes after every value (0037): after a value, an
 * optional key also takes the rows that have none, and nothing comes after
 * a missing one but the rows that tie on it. A required key's filter is a
 * plain comparison.
 */
export function after(order: Order, cursor: string): AnyWhere {
  const values = cursorValues(order, cursor);
  const clauses: AnyWhere[] = [];
  const equal: Record<string, FieldOps> = {};
  order.forEach(({ field, direction, optional }, index) => {
    const value = values[index];
    if (value === undefined) throw badCursor('The cursor is malformed');
    if (value !== null) {
      const beyond = direction === 1 ? { gt: value } : { lt: value };
      clauses.push(
        optional
          ? {
              ...equal,
              or: [{ [field]: beyond }, { [field]: { exists: false } }],
            }
          : { ...equal, [field]: beyond },
      );
    }
    equal[field] = value === null ? { exists: false } : { eq: value };
  });
  return { or: clauses };
}
