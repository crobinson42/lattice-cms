import { z } from 'zod';

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
        limit: z.number().int().positive().optional(),
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

export function collection<
  const Slug extends string,
  Shape extends z.core.$ZodShape,
>(slug: Slug, options: { schema: Schema<Shape> }): Collection<Slug, Shape> {
  return {
    slug,
    schema: options.schema,
    output: operations(options.schema).get.output,
  };
}
