import { z } from 'zod';
import { maxLimit, sortSchema } from './sort.js';
import { innerOf, whereSchema } from './where.js';

/** The operations Lattice generates for every collection. */
export type Action = 'find' | 'get' | 'create' | 'update' | 'delete';

const systemShape = {
  id: z.string(),
  // ISO 8601 strings, not Date: ts-pf sends JSON, so a Date would reach an
  // HTTP client as a string while its type still said Date.
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

// Only `z.object()`: unknown keys are stripped. A loose object would let any
// key into the store, and its index signature would reach every client type.
type Schema<Shape extends z.core.$ZodShape> = z.ZodObject<Shape, z.core.$strip>;

/** The input and output schema of each generated operation. */
export function operations<Shape extends z.core.$ZodShape>(
  schema: Schema<Shape>,
) {
  const output = schema.extend(systemShape);
  const id = z.object({ id: z.string() });
  return {
    find: {
      input: z.object({
        where: whereSchema(output).optional(),
        sort: sortSchema(output).optional(),
        // No Zod default: ts-pf types input by the schema's output, so a
        // default would make limit required for every client. The generated
        // find applies defaultSort and defaultLimit.
        limit: z.number().int().min(1).max(maxLimit).optional(),
        after: z.string().optional(),
      }),
      output: z.object({ docs: z.array(output), next: z.string().nullable() }),
    },
    get: { input: id, output },
    create: { input: schema, output },
    update: { input: schema.partial().extend({ id: z.string() }), output },
    delete: { input: id, output },
  };
}

export type Operations<Shape extends z.core.$ZodShape> = ReturnType<
  typeof operations<Shape>
>;

/** A collection declaration. It names no use case classes. */
export interface Collection<
  Slug extends string,
  Shape extends z.core.$ZodShape,
> {
  readonly slug: Slug;
  readonly schema: Schema<Shape>;
  /** The document a read returns: the schema plus `id`, `createdAt` and `updatedAt`. */
  readonly output: Operations<Shape>['get']['output'];
}

export type AnyCollection = Collection<string, z.core.$ZodShape>;

// System fields, and the `Where` keys that combine filters. A schema field
// with one of these names would be replaced or would read as a filter.
const reservedFields = ['id', 'createdAt', 'updatedAt', 'and', 'or'] as const;
type ReservedField = (typeof reservedFields)[number];

type DateField<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape]: [Exclude<z.output<Shape[K]>, null | undefined>] extends [
    never,
  ]
    ? never
    : [Exclude<z.output<Shape[K]>, null | undefined>] extends [Date]
      ? K
      : never;
}[keyof Shape];

// A rejected schema adds a key the options lack, so the error names the
// field. Only top-level Dates are checked here; collection() finds the rest.
type FieldCheck<Shape extends z.core.$ZodShape> = [
  keyof Shape & ReservedField,
] extends [never]
  ? [DateField<Shape>] extends [never]
    ? unknown
    : {
        readonly '~error': `"${DateField<Shape> & string}" is a Date; store an ISO string (z.iso.datetime())`;
      }
  : {
      readonly '~error': `"${keyof Shape & ReservedField}" is a reserved field name`;
    };

/** The schemas inside `schema`, each with the path suffix that reaches it. */
function children(schema: z.core.$ZodType): [z.core.$ZodType, string][] {
  const inner = innerOf(schema);
  if (inner !== undefined) return [[inner, '']];
  if (schema instanceof z.core.$ZodUnion) {
    return schema._zod.def.options.map((option) => [option, '']);
  }
  if (schema instanceof z.core.$ZodArray) {
    return [[schema._zod.def.element, '[]']];
  }
  if (schema instanceof z.core.$ZodObject) {
    return Object.entries(schema._zod.def.shape).map(([key, field]) => [
      field,
      `.${key}`,
    ]);
  }
  return [];
}

/**
 * Rejects field forms the contract cannot carry honestly. A Date reaches an
 * HTTP client as a string. A transform hides a field's kind, so a `Where` on
 * it cannot be checked; normalizing belongs in a beforeChange hook (0012).
 */
function checkField(path: string, schema: z.core.$ZodType): void {
  const { type } = schema._zod.def;
  if (type === 'date') {
    throw new Error(
      `Lattice: "${path}" is a Date; store an ISO string (z.iso.datetime())`,
    );
  }
  if (type === 'pipe' || type === 'transform') {
    throw new Error(
      `Lattice: "${path}" has a transform; use a beforeChange hook`,
    );
  }
  for (const [child, suffix] of children(schema)) {
    checkField(`${path}${suffix}`, child);
  }
}

export function collection<
  const Slug extends string,
  Shape extends z.core.$ZodShape,
>(
  slug: Slug,
  options: { schema: Schema<Shape> } & FieldCheck<Shape>,
): Collection<Slug, Shape> {
  for (const [name, field] of Object.entries(options.schema.shape)) {
    if (reservedFields.some((reserved) => reserved === name)) {
      throw new Error(`Lattice: "${name}" is a reserved field name`);
    }
    checkField(`${slug}.${name}`, field);
  }
  return {
    slug,
    schema: options.schema,
    output: operations(options.schema).get.output,
  };
}
