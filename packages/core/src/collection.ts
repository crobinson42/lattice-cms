import { Event, type EventCatalog } from 'hexok';
import { z } from 'zod';
import { defaultLimit, maxLimit, sortSchema } from './sort.js';
import { tenantShapes } from './tenancy.js';
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

/** A stored document's schema: the schema plus the system fields and the tenant field. */
function outputOf<Shape extends z.core.$ZodShape, Tenant extends string>(
  schema: Schema<Shape>,
  tenant: Tenant | undefined,
) {
  return schema.extend({ ...systemShape, ...tenantShapes(tenant).field });
}

type Output<Shape extends z.core.$ZodShape, Tenant extends string> = ReturnType<
  typeof outputOf<Shape, Tenant>
>;

/**
 * The input and output schema of each generated operation, from the
 * collection's schema and its output. The output has the tenant field;
 * create and update input never do, so a client cannot set or change it.
 */
export function operations<
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
>(schema: Schema<Shape>, output: Output<Shape, Tenant>) {
  const id = z.object({ id: z.string() });
  return {
    find: {
      input: z.object({
        where: whereSchema(output).optional(),
        sort: sortSchema(output),
        limit: z.number().int().min(1).max(maxLimit).default(defaultLimit),
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

export type Operations<
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> = ReturnType<typeof operations<Shape, Tenant>>;

/**
 * The event classes of a collection, one per write. A payload's `doc` is the
 * stored document, before afterRead: an event records what was written, and
 * afterRead only shapes what a read returns. A tenanted collection's events
 * also carry `tenantId`, so a handler can scope itself to that tenant.
 */
function events<
  const Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string,
>(
  slug: Slug,
  output: Operations<Shape, Tenant>['get']['output'],
  tenant: Tenant | undefined,
) {
  const base = { actorId: z.string(), ...tenantShapes(tenant).event };
  return {
    created: Event(`${slug}.created`, z.object({ doc: output, ...base })),
    updated: Event(
      `${slug}.updated`,
      z.object({ doc: output, previous: output, ...base }),
    ),
    deleted: Event(`${slug}.deleted`, z.object({ doc: output, ...base })),
  };
}

export type Events<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> = ReturnType<typeof events<Slug, Shape, Tenant>>;

/** A collection's data without system fields: what create takes. */
export type Data<Shape extends z.core.$ZodShape> = z.output<Schema<Shape>>;

/** A stored document: the data plus `id`, `createdAt`, `updatedAt` and the tenant field. */
export type Document<
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> = z.output<Operations<Shape, Tenant>['get']['output']>;

export type ChangeArgs<
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> =
  | { readonly data: Data<Shape>; readonly operation: 'create' }
  | {
      readonly data: Data<Shape>;
      readonly operation: 'update';
      /** The stored document before this change. */
      readonly previous: Document<Shape, Tenant>;
    };

/**
 * Collection hooks. They transform data and nothing else (0019).
 * `beforeChange` gets the whole document after the change, without system
 * fields, on create and update alike. `afterRead` gets every document a
 * generated operation returns.
 */
export type Hooks<
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> = {
  // Method signatures, not function properties: a method's parameters are
  // bivariant, so every collection stays assignable to AnyCollection.
  beforeChange?(
    args: ChangeArgs<Shape, Tenant>,
  ): Data<Shape> | Promise<Data<Shape>>;
  afterRead?(args: {
    readonly doc: Document<Shape, Tenant>;
  }): Document<Shape, Tenant> | Promise<Document<Shape, Tenant>>;
};

/** A collection declaration. It names no use case classes. */
export interface Collection<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string = never,
> {
  readonly slug: Slug;
  readonly schema: Schema<Shape>;
  /**
   * The field that holds a document's tenant id, or undefined for a global
   * collection. Lattice stamps it on create and filters every call by it.
   */
  readonly tenant: [Tenant] extends [never] ? undefined : Tenant;
  /** The document a read returns: the schema plus `id`, `createdAt`, `updatedAt` and the tenant field. */
  readonly output: Operations<Shape, Tenant>['get']['output'];
  /**
   * The hexok `Event` classes its generated writes publish, with tokens
   * `<slug>.created`, `.updated` and `.deleted`. The app lists them in its
   * own catalog.
   */
  readonly events: Events<Slug, Shape, Tenant>;
  readonly beforeChange?: Hooks<Shape, Tenant>['beforeChange'];
  readonly afterRead?: Hooks<Shape, Tenant>['afterRead'];
  /** The same collection with these hooks. A later call replaces a hook it names. */
  hooks(hooks: Hooks<Shape, Tenant>): Collection<Slug, Shape, Tenant>;
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
  'events' | 'hooks' | 'tenant'
> & {
  readonly tenant: string | undefined;
  readonly events: Readonly<
    Record<keyof Events<string, z.core.$ZodShape>, AnyEventClass>
  >;
};

// System fields, and the `Where` keys that combine filters. A schema field
// with one of these names would be replaced or would read as a filter.
const reservedFields = ['id', 'createdAt', 'updatedAt', 'and', 'or'] as const;
type ReservedField = (typeof reservedFields)[number];

// Names a store would misread: MongoDB reads a dot as a path, a leading `$`
// as an operator, and `_id` is where a store keeps `id`.
type StoreName = `${string}.${string}` | `$${string}` | '_id';

function isStoreName(name: string): boolean {
  return name.includes('.') || name.startsWith('$') || name === '_id';
}

const storeNameError = (name: string) =>
  `"${name}" is not a valid field name: it contains ".", starts with "$" or is "_id"`;

type DateField<Shape extends z.core.$ZodShape> = {
  [K in keyof Shape]: [Exclude<z.output<Shape[K]>, null | undefined>] extends [
    never,
  ]
    ? never
    : [Exclude<z.output<Shape[K]>, null | undefined>] extends [Date]
      ? K
      : never;
}[keyof Shape];

// A rejected tenant adds a key the options lack, so the error names it. The
// tenant field is Lattice's, like the system fields.
type TenantCheck<Shape extends z.core.$ZodShape, Tenant extends string> = [
  Tenant & (keyof Shape | ReservedField | StoreName),
] extends [never]
  ? unknown
  : {
      readonly '~error': `tenant "${Tenant & string}" is stamped by Lattice; it cannot be a schema field, a reserved name or an invalid field name`;
    };

// A rejected schema adds a key the options lack, so the error names the
// field. Only top-level Dates are checked here; collection() finds the rest.
type FieldCheck<Shape extends z.core.$ZodShape> = [
  keyof Shape & ReservedField,
] extends [never]
  ? [keyof Shape & StoreName] extends [never]
    ? [DateField<Shape>] extends [never]
      ? unknown
      : {
          readonly '~error': `"${DateField<Shape> & string}" is a Date; store an ISO string (z.iso.datetime())`;
        }
    : {
        readonly '~error': `"${keyof Shape & StoreName & string}" is not a valid field name: it contains ".", starts with "$" or is "_id"`;
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
  const Tenant extends string = never,
>(
  slug: Slug,
  options: {
    readonly schema: Schema<Shape>;
    /**
     * The field that holds each document's tenant id, such as
     * `'organizationId'`. Lattice adds it to the output, stamps it on
     * create, and filters every call by the caller's tenant.
     */
    readonly tenant?: Tenant;
  } & FieldCheck<Shape> &
    TenantCheck<Shape, Tenant>,
): Collection<Slug, Shape, Tenant> {
  for (const [name, field] of Object.entries(options.schema.shape)) {
    if (reservedFields.some((reserved) => reserved === name)) {
      throw new Error(`Lattice: "${name}" is a reserved field name`);
    }
    if (isStoreName(name)) throw new Error(`Lattice: ${storeNameError(name)}`);
    checkField(`${slug}.${name}`, field);
  }
  const names = Object.keys(options.schema.shape);
  const { tenant } = options;
  if (
    tenant !== undefined &&
    ([...names, ...reservedFields].some((name) => name === tenant) ||
      isStoreName(tenant))
  ) {
    throw new Error(
      `Lattice: tenant "${tenant}" is stamped by Lattice; it cannot be a schema field, a reserved name or an invalid field name`,
    );
  }
  const output = outputOf<Shape, Tenant>(options.schema, tenant);
  return declared<Slug, Shape, Tenant>(
    slug,
    options.schema,
    tenantShapes(tenant).tenant,
    output,
    events(slug, output, tenant),
    {},
  );
}

// A collection with other hooks keeps the same event classes: a catalog
// matches an event to its class with instanceof.
function declared<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string,
>(
  slug: Slug,
  schema: Schema<Shape>,
  tenant: Collection<Slug, Shape, Tenant>['tenant'],
  output: Operations<Shape, Tenant>['get']['output'],
  events: Events<Slug, Shape, Tenant>,
  hooks: Hooks<Shape, Tenant>,
): Collection<Slug, Shape, Tenant> {
  return {
    slug,
    schema,
    tenant,
    output,
    events,
    ...hooks,
    hooks: (next) =>
      declared<Slug, Shape, Tenant>(slug, schema, tenant, output, events, {
        ...hooks,
        ...next,
      }),
  };
}
