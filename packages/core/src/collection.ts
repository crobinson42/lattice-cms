import { Event, type EventCatalog } from 'hexok';
import { z } from 'zod';
import { maxLimit, sortSchema } from './sort.js';
import { innerOf, whereSchema, wrapperOf } from './where.js';

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

// The shape `schema.partial().extend({ id })` would have, as Zod types it.
type PatchShape<Shape extends z.core.$ZodShape> = z.core.util.Extend<
  { -readonly [K in keyof Shape]: z.ZodOptional<Shape[K]> },
  { id: z.ZodString }
>;

/**
 * A schema with its `default` and `prefault` wrappers removed, wherever they
 * sit in its wrapper chain. Every other wrapper is kept around the stripped
 * inner schema.
 */
function withoutDefault(schema: z.core.$ZodType): z.core.$ZodType {
  const wrapper = wrapperOf(schema);
  if (wrapper === undefined) return schema;
  const inner = withoutDefault(wrapper.inner);
  return schema instanceof z.core.$ZodDefault ||
    schema instanceof z.core.$ZodPrefault
    ? inner
    : wrapper.around(inner);
}

/**
 * The update input: `id` and every field optional, with no defaults. Zod 4's
 * `.partial()` keeps `default` and `prefault`, even inside `.optional()`, so
 * a patch that omits a defaulted field would reset it. Each field is rebuilt
 * without them. The overload states the type `.partial()` would give; the
 * implementation rebuilds the shape in a loop, which a mapped type cannot
 * express.
 */
function patchSchema<Shape extends z.core.$ZodShape>(
  schema: Schema<Shape>,
): z.ZodObject<PatchShape<Shape>, z.core.$strip>;
function patchSchema(schema: z.ZodObject): z.ZodObject {
  return z.object({
    ...Object.fromEntries(
      Object.entries(schema.shape).map(([name, field]) => [
        name,
        z.optional(withoutDefault(field)),
      ]),
    ),
    id: z.string(),
  });
}

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
    update: { input: patchSchema(schema), output },
    delete: { input: id, output },
  };
}

export type Operations<Shape extends z.core.$ZodShape> = ReturnType<
  typeof operations<Shape>
>;

/**
 * The event classes of a collection, one per write. A payload's `doc` is the
 * stored document, before afterRead: an event records what was written, and
 * afterRead only shapes what a read returns.
 */
function events<const Slug extends string, Shape extends z.core.$ZodShape>(
  slug: Slug,
  output: Operations<Shape>['get']['output'],
) {
  const actorId = z.string();
  return {
    created: Event(`${slug}.created`, z.object({ doc: output, actorId })),
    updated: Event(
      `${slug}.updated`,
      z.object({ doc: output, previous: output, actorId }),
    ),
    deleted: Event(`${slug}.deleted`, z.object({ doc: output, actorId })),
  };
}

export type Events<
  Slug extends string,
  Shape extends z.core.$ZodShape,
> = ReturnType<typeof events<Slug, Shape>>;

/** A collection's data without system fields: what create takes. */
export type Data<Shape extends z.core.$ZodShape> = z.output<Schema<Shape>>;

/** A stored document: the data plus `id`, `createdAt` and `updatedAt`. */
export type Document<Shape extends z.core.$ZodShape> = z.output<
  Operations<Shape>['get']['output']
>;

export type ChangeArgs<Shape extends z.core.$ZodShape> =
  | { readonly data: Data<Shape>; readonly operation: 'create' }
  | {
      readonly data: Data<Shape>;
      readonly operation: 'update';
      /** The stored document before this change. */
      readonly previous: Document<Shape>;
    };

/**
 * Collection hooks. They transform data and nothing else (0019).
 * `beforeChange` gets the whole document after the change, without system
 * fields, on create and update alike. `afterRead` gets every document a
 * generated operation returns.
 */
export type Hooks<Shape extends z.core.$ZodShape> = {
  // Method signatures, not function properties: a method's parameters are
  // bivariant, so every collection stays assignable to AnyCollection.
  beforeChange?(args: ChangeArgs<Shape>): Data<Shape> | Promise<Data<Shape>>;
  afterRead?(args: {
    readonly doc: Document<Shape>;
  }): Document<Shape> | Promise<Document<Shape>>;
};

/** A collection declaration. It names no use case classes. */
export interface Collection<
  Slug extends string,
  Shape extends z.core.$ZodShape,
> {
  readonly slug: Slug;
  readonly schema: Schema<Shape>;
  /** The document a read returns: the schema plus `id`, `createdAt` and `updatedAt`. */
  readonly output: Operations<Shape>['get']['output'];
  /**
   * The hexok `Event` classes its generated writes publish, with tokens
   * `<slug>.created`, `.updated` and `.deleted`. The app lists them in its
   * own catalog.
   */
  readonly events: Events<Slug, Shape>;
  readonly beforeChange?: Hooks<Shape>['beforeChange'];
  readonly afterRead?: Hooks<Shape>['afterRead'];
  /** The same collection with these hooks. A later call replaces a hook it names. */
  hooks(hooks: Hooks<Shape>): Collection<Slug, Shape>;
}

/** An event class as hexok's `EventCatalog` takes it, whatever its payload. */
type AnyEventClass = Parameters<typeof EventCatalog>[1][string];

/**
 * Any collection, as the framework reads it. Its event classes are erased
 * the way a catalog erases them: an `Event` class's payload type is both a
 * constructor parameter and a property, so one collection's classes fit no
 * wider payload type. `hooks()` is left out because it returns them.
 */
export type AnyCollection = Omit<
  Collection<string, z.core.$ZodShape>,
  'events' | 'hooks'
> & {
  readonly events: Readonly<
    Record<keyof Events<string, z.core.$ZodShape>, AnyEventClass>
  >;
};

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
  const output = operations(options.schema).get.output;
  return declared(slug, options.schema, output, events(slug, output), {});
}

// A collection with other hooks keeps the same event classes: a catalog
// matches an event to its class with instanceof.
function declared<Slug extends string, Shape extends z.core.$ZodShape>(
  slug: Slug,
  schema: Schema<Shape>,
  output: Operations<Shape>['get']['output'],
  events: Events<Slug, Shape>,
  hooks: Hooks<Shape>,
): Collection<Slug, Shape> {
  return {
    slug,
    schema,
    output,
    events,
    ...hooks,
    hooks: (next) =>
      declared(slug, schema, output, events, { ...hooks, ...next }),
  };
}
