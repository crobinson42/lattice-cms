import { z } from 'zod';
import { refusedGroup } from './describe.js';
import { markOf } from './marker.js';
import { type KindOf, kindOf, whereSchema } from './where.js';

/** The most groups a countBy returns, and how many it returns by default (0046). */
export const maxGroups = 1000;

// A value or an array element that compares by equality. Objects have no key.
const groupableKinds = [
  'string',
  'number',
  'enum',
  'boolean',
  'array',
] as const;

// The system fields are unique or near unique: a group of each is no count.
const systemFields = ['id', 'createdAt', 'updatedAt'] as const;

/** Whether a field can be counted by: of a groupable kind. Mirrors `groupable`. */
export type IsGroupable<V> =
  KindOf<V> extends (typeof groupableKinds)[number] ? true : false;

/** Whether a field can be counted by, from its schema. Mirrors `IsGroupable`. */
function groupable(schema: z.core.$ZodType): boolean {
  const kind = kindOf(schema);
  return groupableKinds.some((k) => k === kind);
}

/** A field a countBy can count by. */
export type GroupableField<Doc> = {
  [K in Exclude<
    keyof Doc & string,
    (typeof systemFields)[number]
  >]: IsGroupable<Doc[K]> extends true ? K : never;
}[Exclude<keyof Doc & string, (typeof systemFields)[number]>];

/** The key a field's documents count under: a value, an element, or null. */
export type GroupKey<V> =
  Exclude<V, null | undefined> extends readonly (infer E)[]
    ? Exclude<E, undefined> | null
    : Exclude<V, undefined> | null;

/** One group of a countBy on `Field`. */
export type GroupOf<Doc, Field extends keyof Doc> = {
  readonly key: GroupKey<Doc[Field]>;
  readonly count: number;
};

/** What a countBy on `Field` returns. `more` says groups past the limit were cut. */
export type GroupsOf<Doc, Field extends keyof Doc> = {
  readonly groups: GroupOf<Doc, Field>[];
  readonly more: boolean;
};

/**
 * The validator of countBy's `field` on documents of `schema`. Its overload
 * states the static type; the implementation lists the fields it reads from
 * the shape at runtime, as `sortSchema` does. The enum's error says why a
 * field is refused.
 */
function fieldSchema<S extends z.ZodObject>(
  schema: S,
): z.ZodType<GroupableField<z.output<S>>, GroupableField<z.output<S>>>;
function fieldSchema(schema: z.ZodObject): z.ZodType {
  const fields = Object.entries(schema.shape).filter(
    ([name]) => !systemFields.some((system) => system === name),
  );
  const names = fields
    .filter(([, field]) => groupable(field))
    .map(([name]) => name);
  const field = z.enum(names, {
    error: ({ input }) => {
      if (typeof input !== 'string') return undefined;
      return fields.some(([name]) => name === input)
        ? `"${input}" cannot be counted by: it is not a string, number, enum, boolean or an array of them`
        : `"${input}" is not a field to count by`;
    },
  });
  // As on where and sort: the description says a withheld field is refused.
  const maskable = fields
    .filter(([, f]) => markOf(f) !== undefined && groupable(f))
    .map(([name]) => name);
  return maskable.length === 0 ? field : field.describe(refusedGroup(maskable));
}

/** countBy's input and output schemas, on documents of `output`. */
export function countBySchemas<S extends z.ZodObject>(output: S) {
  return {
    input: z.object({
      field: fieldSchema(output),
      where: whereSchema(output).optional(),
      limit: z.number().int().min(1).max(maxGroups).default(maxGroups),
    }),
    // The key is wide: ts-pf types an output, not an output per input field.
    // `Repo.countBy` types it from the field.
    output: z.object({
      groups: z.array(
        z.object({
          key: z.union([z.string(), z.number(), z.boolean(), z.null()]),
          count: z.number().int().nonnegative(),
        }),
      ),
      more: z.boolean(),
    }),
  };
}
