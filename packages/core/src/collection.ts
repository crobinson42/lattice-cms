import { Event, type EventCatalog } from 'hexok';
import { z } from 'zod';
import {
  type AnyMany,
  type JoinShape,
  joinSchemas,
  type LinkShape,
  type Many,
  type ManyOnDelete,
  type RefCheck,
  type RefField,
  refsOf,
} from './relations.js';
import { defaultLimit, maxLimit, sortSchema } from './sort.js';
import type { Index } from './store.js';
import { tenantShapes } from './tenancy.js';
import { type AnyWhere, innerOf, whereSchema, wrapperOf } from './where.js';

/** The operations Lattice generates for every collection. */
export type Action = 'find' | 'count' | 'get' | 'create' | 'update' | 'delete';

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

/** The fields Lattice adds to a collection's schema: system and tenant. */
type Stamped<Tenant extends string> = typeof systemShape &
  Record<Tenant, z.ZodString>;

/**
 * The stored document's schema, as zod's `extend` types it. It is named, not
 * inferred from `outputOf`: declaration emit spells an inferred type out,
 * dropping zod's `Extend` alias, and the spelled-out form of a join
 * collection's output no longer fits `AnyCollection` in the published .d.ts.
 */
type Output<
  Shape extends z.core.$ZodShape,
  Tenant extends string,
> = z.ZodObject<
  z.core.util.Extend<Shape, z.core.util.Writeable<Stamped<Tenant>>>,
  z.core.$strip
>;

function outputOf<Shape extends z.core.$ZodShape, Tenant extends string>(
  schema: Schema<Shape>,
  tenant: Tenant | undefined,
): Output<Shape, Tenant> {
  // Typed, so `extend` infers `Stamped<Tenant>` itself: an anonymous spread
  // type would make an `Extend` the compiler cannot relate to `Output`.
  const stamped: Stamped<Tenant> = {
    ...systemShape,
    ...tenantShapes(tenant).field,
  };
  return schema.extend(stamped);
}

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
    count: {
      input: z.object({ where: whereSchema(output).optional() }),
      output: z.object({ count: z.number().int().nonnegative() }),
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

/**
 * An index on a collection, by the names of its stored document's fields:
 * the schema's, the system fields and the tenant field. Key order is the
 * index's key order.
 */
export type CollectionIndex<Doc> = {
  readonly fields: { readonly [K in keyof Doc & string]?: 1 | -1 };
  readonly unique?: boolean;
};

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
  Relations extends AnyRelations = Record<never, never>,
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
   * The indexes `build().ensure()` creates: the declared ones, then one per
   * ref field, led by the tenant field.
   */
  readonly indexes: readonly Index[];
  /** The ref fields, with their targets and onDelete. */
  readonly refs: readonly RefField[];
  /** Each `many()` relation, with its derived join collection. */
  readonly relations: Relations;
  /**
   * The hexok `Event` classes its generated writes publish, with tokens
   * `<slug>.created`, `.updated` and `.deleted`. The app lists them in its
   * own catalog.
   */
  readonly events: Events<Slug, Shape, Tenant>;
  readonly beforeChange?: Hooks<Shape, Tenant>['beforeChange'];
  readonly afterRead?: Hooks<Shape, Tenant>['afterRead'];
  /** The same collection with these hooks. A later call replaces a hook it names. */
  hooks(
    hooks: Hooks<Shape, Tenant>,
  ): Collection<Slug, Shape, Tenant, Relations>;
}

/** A relation as the framework reads it, whatever its collections. */
export type AnyRelation = {
  readonly target: string;
  readonly onDelete: ManyOnDelete;
  readonly through: AnyCollection;
  readonly parentField: string;
  readonly targetField: string;
  readonly list: {
    readonly input: z.ZodType<
      {
        readonly id: string;
        readonly where?: AnyWhere | undefined;
        readonly sort: readonly string[];
        readonly limit: number;
        readonly after?: string | undefined;
        readonly populate?: readonly string[] | undefined;
      },
      // The input type too: the contract's expansion reads `populate` there.
      { readonly populate?: readonly string[] | undefined }
    >;
    readonly output: z.ZodType;
  };
  readonly set: {
    readonly input: z.ZodType<{
      readonly id: string;
      readonly links: readonly Readonly<Record<string, unknown>>[];
    }>;
    readonly output: z.ZodType;
  };
};

export type AnyRelations = Readonly<Record<string, AnyRelation>>;

/** The most links one `set` takes. A bigger relation is a method's work. */
export const maxLinks = 1000;

type JoinOps<
  P extends string,
  Tenant extends string,
  T extends string,
  D extends ManyOnDelete,
  F extends z.core.$ZodShape,
> = Operations<JoinShape<P, T, D, F>, Tenant>;

/**
 * One `many()` relation of collection `P`: the derived join collection, its
 * two ref fields, and the schemas of `<slug>.<relation>.list` and `.set`.
 */
export type Relation<
  P extends string,
  Tenant extends string,
  M extends AnyMany,
> =
  M extends Many<
    infer T extends string,
    infer Th extends string,
    infer F extends z.core.$ZodShape,
    infer D extends ManyOnDelete
  >
    ? {
        readonly target: T;
        readonly onDelete: D;
        readonly through: Collection<Th, JoinShape<P, T, D, F>, Tenant>;
        readonly parentField: `${P}Id`;
        readonly targetField: `${T}Id`;
        readonly list: {
          readonly input: z.ZodObject<
            z.core.util.Extend<
              JoinOps<P, Tenant, T, D, F>['find']['input']['shape'],
              {
                id: z.ZodString;
                populate: z.ZodOptional<
                  z.ZodArray<z.ZodEnum<{ [K in `${P}Id` | `${T}Id`]: K }>>
                >;
              }
            >,
            z.core.$strip
          >;
          readonly output: JoinOps<P, Tenant, T, D, F>['find']['output'];
        };
        readonly set: {
          readonly input: z.ZodObject<
            {
              id: z.ZodString;
              links: z.ZodArray<z.ZodObject<LinkShape<T, D, F>, z.core.$strip>>;
            },
            z.core.$strip
          >;
          readonly output: z.ZodObject<
            { docs: z.ZodArray<JoinOps<P, Tenant, T, D, F>['get']['output']> },
            z.core.$strip
          >;
        };
      }
    : never;

export type RelationsOf<
  P extends string,
  Tenant extends string,
  R extends Readonly<Record<string, AnyMany>>,
> = { readonly [K in keyof R]: Relation<P, Tenant, R[K]> };

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
  'events' | 'hooks' | 'tenant' | 'relations'
> & {
  readonly tenant: string | undefined;
  readonly relations: AnyRelations;
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

/** `<relation>.<field>` for each link field a join collection cannot have. */
type BadLinkField<Slug extends string, Tenant extends string, R> = {
  [K in keyof R]: R[K] extends Many<
    infer T extends string,
    string,
    infer F,
    ManyOnDelete
  >
    ? `${K & string}.${keyof F & (`${Slug}Id` | `${T}Id` | ReservedField | Tenant | StoreName) & string}`
    : never;
}[keyof R];

// A rejected relation adds a key the options lack, so the error names it.
type RelationCheck<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string,
  R,
> = [BadLinkField<Slug, Tenant, R>] extends [never]
  ? RelationNameCheck<Slug, Shape, R>
  : {
      readonly '~error': `link field "${BadLinkField<Slug, Tenant, R>}" is a ref field, a reserved name, the tenant or an invalid field name`;
    };

type RelationNameCheck<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  R,
> = [keyof R & (keyof Shape | Action | 'read')] extends [never]
  ? {
      [K in keyof R]: R[K] extends { readonly target: Slug }
        ? `${K & string} relates ${Slug} to itself, which many() does not support`
        : never;
    }[keyof R] extends infer E
    ? [E] extends [never]
      ? unknown
      : { readonly '~error': E }
    : never
  : {
      readonly '~error': `relation "${keyof R & (keyof Shape | Action | 'read') & string}" has the name of a field, an action or an access key`;
    };

export function collection<
  const Slug extends string,
  Shape extends z.core.$ZodShape,
  const Tenant extends string = never,
  const R extends Readonly<Record<string, AnyMany>> = Record<never, never>,
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
    /**
     * Indexes the store creates at startup, through `build().ensure()`. A
     * tenanted collection's indexes usually lead with the tenant field.
     */
    readonly indexes?: readonly CollectionIndex<
      z.output<Output<Shape, Tenant>>
    >[];
    /**
     * `many()` relations, by name. Each derives a join collection and gets
     * `<slug>.<name>.list` and `.set`.
     */
    readonly relations?: R;
  } & FieldCheck<Shape> &
    RefCheck<Shape> &
    TenantCheck<Shape, Tenant> &
    RelationCheck<Slug, Shape, Tenant, R>,
): Collection<Slug, Shape, Tenant, RelationsOf<Slug, Tenant, R>> {
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
  const relations: Readonly<Record<string, AnyMany>> = options.relations ?? {};
  for (const [name, relation] of Object.entries(relations)) {
    if ([...names, ...actions, 'read'].some((other) => other === name)) {
      throw new Error(
        `Lattice: relation "${name}" has the name of a field, an action or an access key`,
      );
    }
    if (relation.target === slug) {
      throw new Error(
        `Lattice: ${name} relates ${slug} to itself, which many() does not support`,
      );
    }
  }
  // A stored index names each field with its direction; an optional key
  // left undefined names nothing.
  const declaredIndexes: readonly Index[] = (options.indexes ?? []).map(
    ({ fields, unique }) => ({
      fields: Object.fromEntries(
        Object.entries(fields).flatMap(
          ([field, direction]): [string, 1 | -1][] =>
            direction === 1 || direction === -1 ? [[field, direction]] : [],
        ),
      ),
      ...(unique === undefined ? {} : { unique }),
    }),
  );
  return define<Slug, Shape, Tenant, RelationsOf<Slug, Tenant, R>>(
    slug,
    options.schema,
    tenant,
    declaredIndexes,
    relationsOf(slug, tenant, options.relations),
  );
}

/** The generated operations, for the relation-name check. */
const actions = ['find', 'count', 'get', 'create', 'update', 'delete'];

/**
 * A collection from a checked schema: its output, refs, indexes and events.
 * `collection()` checks a user's options and calls it; a join collection is
 * defined here directly.
 */
function define<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string,
  Relations extends AnyRelations,
>(
  slug: Slug,
  schema: Schema<Shape>,
  tenant: Tenant | undefined,
  declaredIndexes: readonly Index[],
  relations: Relations,
): Collection<Slug, Shape, Tenant, Relations> {
  const output = outputOf<Shape, Tenant>(schema, tenant);
  const fields = Object.keys(output.shape);
  for (const index of declaredIndexes) {
    const keys = Object.keys(index.fields);
    if (keys.length === 0) {
      throw new Error(`Lattice: an index on "${slug}" names no fields`);
    }
    const unknown = keys.find((key) => !fields.includes(key));
    if (unknown !== undefined) {
      throw new Error(
        `Lattice: an index on "${slug}" names "${unknown}", which is not a field`,
      );
    }
  }
  const refs = refsOf(slug, schema.shape);
  // restrict, cascade and nullify look children up by their ref field,
  // within the tenant: each ref gets an index, unless a declared one starts
  // with the same keys, which serves the lookup as well.
  const refIndexes = refs
    .map(
      ({ field }): Index => ({
        fields:
          tenant === undefined ? { [field]: 1 } : { [tenant]: 1, [field]: 1 },
      }),
    )
    .filter(
      (index) => !declaredIndexes.some((other) => startsWith(other, index)),
    );
  return declared<Slug, Shape, Tenant, Relations>(
    slug,
    schema,
    tenantShapes(tenant).tenant,
    [...declaredIndexes, ...refIndexes],
    refs,
    relations,
    output,
    events(slug, output, tenant),
    {},
  );
}

/**
 * The relations of collection `parent`, each with its derived join
 * collection. The overload states each relation's types, including the
 * join's computed field names; the implementation builds them in a loop,
 * which a mapped type cannot express.
 */
function relationsOf<
  P extends string,
  Tenant extends string,
  R extends Readonly<Record<string, AnyMany>>,
>(
  parent: P,
  tenant: Tenant | undefined,
  relations: R | undefined,
): RelationsOf<P, Tenant, R>;
function relationsOf(
  parent: string,
  tenant: string | undefined,
  relations: Readonly<Record<string, AnyMany>> | undefined,
): AnyRelations {
  return Object.fromEntries(
    Object.entries(relations ?? {}).map(([name, relation]) => [
      name,
      relationOf(parent, tenant, relation),
    ]),
  );
}

function relationOf(
  parent: string,
  tenant: string | undefined,
  relation: AnyMany,
): AnyRelation {
  const { join, link, parentField, targetField } = joinSchemas(
    parent,
    relation,
  );
  const fieldNames = Object.keys(relation.fields?.shape ?? {});
  const clash = fieldNames.find(
    (name) =>
      name === parentField ||
      name === targetField ||
      reservedFields.some((reserved) => reserved === name) ||
      name === tenant ||
      isStoreName(name),
  );
  if (clash !== undefined) {
    throw new Error(
      `Lattice: "${relation.through}" link field "${clash}" is a ref field, a reserved name, the tenant or an invalid field name`,
    );
  }
  const keys = (...fields: string[]): Index['fields'] =>
    Object.fromEntries(
      [...(tenant === undefined ? [] : [tenant]), ...fields].map((field) => [
        field,
        1,
      ]),
    );
  // One link per pair, and a lookup from each side: list and a parent's
  // cascade read the pair index's prefix, a target's onDelete the other.
  const through = define(
    relation.through,
    join,
    tenant,
    [
      { fields: keys(parentField, targetField), unique: true },
      { fields: keys(targetField) },
    ],
    {},
  );
  const ops = operations(through.schema, through.output);
  return {
    target: relation.target,
    onDelete: relation.onDelete ?? 'restrict',
    through,
    parentField,
    targetField,
    list: {
      // A link's ref fields populate as on any read.
      input: ops.find.input.extend({
        id: z.string(),
        populate: z.array(z.enum([parentField, targetField])).optional(),
      }),
      output: ops.find.output,
    },
    set: {
      input: z.object({
        id: z.string(),
        links: z
          .array(link)
          .max(maxLinks)
          .superRefine((links, ctx) => {
            const seen = new Set<unknown>();
            links.forEach((value, index) => {
              const target = value[targetField];
              if (seen.has(target)) {
                ctx.addIssue({
                  code: 'custom',
                  path: [index, targetField],
                  message: `${targetField} repeats an earlier link`,
                });
              }
              seen.add(target);
            });
          }),
      }),
      output: z.object({ docs: z.array(through.output) }),
    },
  };
}

// A collection with other hooks keeps the same event classes: a catalog
// matches an event to its class with instanceof.
function declared<
  Slug extends string,
  Shape extends z.core.$ZodShape,
  Tenant extends string,
  Relations extends AnyRelations,
>(
  slug: Slug,
  schema: Schema<Shape>,
  tenant: Collection<Slug, Shape, Tenant>['tenant'],
  indexes: readonly Index[],
  refs: readonly RefField[],
  relations: Relations,
  output: Operations<Shape, Tenant>['get']['output'],
  events: Events<Slug, Shape, Tenant>,
  hooks: Hooks<Shape, Tenant>,
): Collection<Slug, Shape, Tenant, Relations> {
  return {
    slug,
    schema,
    tenant,
    indexes,
    refs,
    relations,
    output,
    events,
    ...hooks,
    hooks: (next) =>
      declared<Slug, Shape, Tenant, Relations>(
        slug,
        schema,
        tenant,
        indexes,
        refs,
        relations,
        output,
        events,
        { ...hooks, ...next },
      ),
  };
}

/** Whether index `a` starts with the keys of `b`, in the same order and directions. */
function startsWith(a: Index, b: Index): boolean {
  const left = Object.entries(a.fields);
  return Object.entries(b.fields).every(([field, direction], i) => {
    const other = left[i];
    return other !== undefined && other[0] === field && other[1] === direction;
  });
}
