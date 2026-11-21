/**
 * Phase 1 step 1: the type spike for relations, access, tenancy and
 * population. Type-level stubs with the least runtime the tests need. Nothing
 * here is exported from `src/index.ts`.
 */
import {
  type CallOptions,
  type ClientError,
  type ContractClient,
  type ContractProcedure,
  type ContractResultPromise,
  type ContractRouterBrand,
  procedure,
  router,
} from '@ts-pf/contract';
import {
  createImplementer,
  type ImplementedProcedure,
  type ImplementedRouter,
} from '@ts-pf/server';
import type { StandardSchemaV1 } from 'hexok';
import { z } from 'zod';
import { declaredErrors } from '../errors.js';
import { type FamilyContext, family as phase0Family } from '../family.js';
import type { FieldWhere, Where } from '../where.js';

// ---------------------------------------------------------------- ref, many

/** A string field that holds the id of a document in collection `Slug`. */
export type Ref<Slug extends string> = z.ZodString & {
  readonly '~ref': Slug;
};

export function ref<const Slug extends string>(slug: Slug): Ref<Slug> {
  return Object.assign(z.string(), { '~ref': slug });
}

/** A many-to-many relation through the join collection `Through`. */
export type Many<
  Target extends string,
  Through extends string,
  Fields extends z.ZodObject,
> = {
  readonly kind: 'many';
  readonly target: Target;
  readonly through: Through;
  readonly fields: Fields;
};

export function many<
  const Target extends string,
  const Through extends string,
  Fields extends z.ZodObject,
>(
  target: Target,
  options: { readonly through: Through; readonly fields: Fields },
): Many<Target, Through, Fields> {
  return { kind: 'many', target, ...options };
}

type AnyMany = Many<string, string, z.ZodObject>;
type Relations = Readonly<Record<string, AnyMany>>;

// ---------------------------------------------------------------- collection

type Shape = z.core.$ZodShape;
type Schema<S extends Shape> = z.ZodObject<S, z.core.$strip>;

const systemShape = {
  id: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
};

/**
 * The tenant field's schema, keyed by its name. The overload states the
 * key; a computed key types as an index signature.
 */
function tenantShape<T extends string>(
  tenant: T | undefined,
): Record<T, z.ZodString>;
function tenantShape(tenant: string | undefined): Record<string, z.ZodString> {
  return tenant === undefined ? {} : { [tenant]: z.string() };
}

function outputOf<S extends Shape, T extends string>(
  schema: Schema<S>,
  tenant: T | undefined,
) {
  return schema.extend({ ...systemShape, ...tenantShape(tenant) });
}

export interface Col<
  Slug extends string,
  S extends Shape,
  Tenant extends string,
  R extends Relations,
> {
  readonly slug: Slug;
  /** What create takes. It has no tenant field: create stamps it. */
  readonly schema: Schema<S>;
  readonly tenant: Tenant | undefined;
  readonly relations: R;
  /** A stored document: the schema, the system fields and the tenant field. */
  readonly output: ReturnType<typeof outputOf<S, Tenant>>;
}

/** Any collection, as the framework reads it. */
export type AnyCol = {
  readonly slug: string;
  readonly schema: Schema<Shape>;
  readonly tenant: string | undefined;
  readonly relations: Relations;
  readonly output: z.ZodObject<Shape, z.core.$strip>;
};

// A rejected tenant adds a key the options lack, so the error names it.
type TenantCheck<S extends Shape, T extends string> = [T & keyof S] extends [
  never,
]
  ? unknown
  : {
      readonly '~error': `tenant "${T & keyof S & string}" is stamped by Lattice; remove it from the schema`;
    };

export function collection<
  const Slug extends string,
  S extends Shape,
  const Tenant extends string = never,
  const R extends Relations = Record<never, never>,
>(
  slug: Slug,
  options: {
    readonly schema: Schema<S>;
    readonly tenant?: Tenant;
    readonly relations?: R;
  } & TenantCheck<S, Tenant>,
): Col<Slug, S, Tenant, R>;
export function collection(
  slug: string,
  options: {
    readonly schema: Schema<Shape>;
    readonly tenant?: string;
    readonly relations?: Relations;
  },
): AnyCol {
  const { schema, tenant, relations = {} } = options;
  return { slug, schema, tenant, relations, output: outputOf(schema, tenant) };
}

// ---------------------------------------------------------------- family

/** Phase 0's family, plus `tenantOf`: the actor's tenant id. */
export function family<A extends StandardSchemaV1>(options: {
  actor: A;
  actorId: (actor: StandardSchemaV1.InferOutput<A>) => string;
  tenantOf?: (actor: StandardSchemaV1.InferOutput<A>) => string;
}) {
  const { actor, actorId, tenantOf } = options;
  return Object.assign(phase0Family({ actor, actorId }), { tenantOf });
}

type SpikeFamily<Actor> = ReturnType<
  typeof family<StandardSchemaV1<unknown, Actor>>
>;

// ---------------------------------------------------------------- types

export type Doc<C extends AnyCol> = z.output<C['output']>;

type RefOf<F> = F extends { readonly '~ref': infer T extends string }
  ? T
  : F extends z.ZodOptional<infer I> | z.ZodNullable<infer I>
    ? RefOf<I>
    : never;

/** Each `ref()` field of `C`, and the slug it refers to. */
type RefFields<C extends AnyCol> = {
  [K in keyof C['schema']['shape'] as [RefOf<C['schema']['shape'][K]>] extends [
    never,
  ]
    ? never
    : K]: RefOf<C['schema']['shape'][K]>;
};

/** What `populate` may name: each `ref()` field and each `many()` relation. */
// The template literal makes an error print the union ('"authorId" |
// "categories"'), not the alias.
export type PopulateKey<C extends AnyCol> = `${
  | (keyof RefFields<C> & string)
  | (keyof C['relations'] & string)}`;

type Entries = Record<string, AnyCol>;

/** A populated document the caller may not read: its id only. */
export type Withheld = { readonly id: string };

type Target<E extends Entries, Slug> = Slug extends keyof E
  ? Doc<E[Slug]>
  : never;

/** A populated value: the target document or `Withheld`. Null and undefined stay. */
type Swap<V, T> = V extends string ? T : V;

type Flat<T> = { [K in keyof T]: T[K] };

/** A populated `many()` link: its fields and the target document. */
type Link<E extends Entries, M extends AnyMany> = Flat<
  z.output<M['fields']> & { readonly doc: Target<E, M['target']> | Withheld }
>;

/** `C`'s document with the relations in `P` populated. */
export type Populated<E extends Entries, C extends AnyCol, P> = Flat<
  {
    [K in keyof Doc<C>]: K extends P & keyof RefFields<C>
      ? Swap<Doc<C>[K], Target<E, RefFields<C>[K]> | Withheld>
      : Doc<C>[K];
  } & {
    [R in P & keyof C['relations']]: Link<E, C['relations'][R]>[];
  }
>;

/** What one contract can say for every call: any relation may be populated. */
type Wide<E extends Entries, C extends AnyCol> = Flat<
  {
    [K in keyof Doc<C>]: K extends keyof RefFields<C>
      ? Doc<C>[K] | Swap<Doc<C>[K], Target<E, RefFields<C>[K]> | Withheld>
      : Doc<C>[K];
  } & {
    [R in keyof C['relations']]?: Link<E, C['relations'][R]>[];
  }
>;

// ---------------------------------------------------------------- access

type AccessAction = 'read' | 'create' | 'update' | 'delete';

/** What an access function may return for `A`. Create has no row to filter. */
type Allowed<A, D> = A extends 'create' ? boolean : boolean | Where<D>;

type AccessArgs<Actor, A, D> = A extends 'create'
  ? { readonly actor: Actor; readonly data: D }
  : { readonly actor: Actor };

/** Each key of a returned `Where` that names no field and no operator. */
type Unknown<W, D> = W extends boolean
  ? never
  :
      | Exclude<keyof W, keyof D | 'and' | 'or'>
      | {
          [K in keyof W & keyof D]: Exclude<keyof W[K], keyof FieldWhere<D[K]>>;
        }[keyof W & keyof D]
      | (W extends { readonly and: readonly (infer I)[] }
          ? Unknown<I, D>
          : never)
      | (W extends { readonly or: readonly (infer I)[] }
          ? Unknown<I, D>
          : never);

type AccessError<R, D, Slug extends string> = {
  [A in keyof R]: A extends AccessAction
    ? [Unknown<R[A], D>] extends [never]
      ? never
      : `access.${A} filters on "${Unknown<R[A], D> & string}", which ${Slug} does not have`
    : `"${A & string}" is not an action of ${Slug}`;
}[keyof R];

// Checked on the options object, not on `access`: a check on `access` would
// depend on the functions it types, and their `actor` would lose its type.
type AccessCheck<R, D, Slug extends string> = [
  AccessError<R, D, Slug>,
] extends [never]
  ? unknown
  : { readonly '~error': AccessError<R, D, Slug> };

/**
 * The access functions for one collection. Each return type is inferred, so
 * `AccessCheck` can name an unknown field: TypeScript does not check excess
 * properties on an object literal an arrow function returns.
 */
type AccessFns<Actor, R, D> = {
  readonly [A in keyof R]: (
    args: AccessArgs<Actor, A, D>,
  ) => R[A] | Promise<R[A]>;
};

// ---------------------------------------------------------------- contract

type Declared = typeof declaredErrors;

type Proc<I, O> = ContractProcedure<I, O, Declared, Record<never, never>, I>;

type Populate<C extends AnyCol> = [PopulateKey<C>] extends [never]
  ? unknown
  : { readonly populate?: readonly PopulateKey<C>[] };

type GetInput<C extends AnyCol> = { readonly id: string } & Populate<C>;

type FindInput<C extends AnyCol> = {
  readonly where?: Where<Doc<C>>;
  readonly limit?: number;
  readonly after?: string;
} & Populate<C>;

type Page<D> = { docs: D[]; next: string | null };

type LinkDoc<C extends AnyCol, M extends AnyMany> = Flat<
  z.output<M['fields']> & {
    id: string;
    createdAt: string;
    updatedAt: string;
  } & Record<`${C['slug']}Id` | `${M['target']}Id`, string>
>;

type LinkInput<M extends AnyMany> = Flat<
  z.input<M['fields']> & Record<`${M['target']}Id`, string>
>;

/** `<slug>.<relation>.list` and `.set` for one `many()` relation. */
type RelationSlice<C extends AnyCol, M extends AnyMany> = {
  list: Proc<
    { readonly id: string; readonly limit?: number; readonly after?: string },
    Page<LinkDoc<C, M>>
  >;
  set: Proc<
    { readonly id: string; readonly links: readonly LinkInput<M>[] },
    { docs: LinkDoc<C, M>[] }
  >;
};

type Slice<E extends Entries, C extends AnyCol> = {
  get: Proc<Flat<GetInput<C>>, Wide<E, C>>;
  find: Proc<Flat<FindInput<C>>, Page<Wide<E, C>>>;
  create: Proc<z.input<C['schema']>, Doc<C>>;
  update: Proc<{ readonly id: string } & Partial<z.input<C['schema']>>, Doc<C>>;
  delete: Proc<{ readonly id: string }, Doc<C>>;
} & {
  [R in keyof C['relations']]: RelationSlice<C, C['relations'][R]>;
};

export type Contract<E extends Entries> = {
  [S in keyof E]: Slice<E, E[S]>;
} & ContractRouterBrand;

// ---------------------------------------------------------------- client

type Errors = ClientError<Declared>;

/**
 * Option (c): a read whose output follows `populate`. `P` is a const tuple,
 * so `['authorId']` needs no `as const`. Left out, `P` is empty and the read
 * returns the plain document.
 */
type GetClient<E extends Entries, C extends AnyCol> = <
  const P extends readonly PopulateKey<C>[] = readonly [],
>(
  input: { readonly id: string; readonly populate?: P },
  options?: CallOptions,
) => ContractResultPromise<Populated<E, C, P[number]>, Errors>;

type FindClient<E extends Entries, C extends AnyCol> = <
  const P extends readonly PopulateKey<C>[] = readonly [],
>(
  input: Omit<FindInput<C>, 'populate'> & { readonly populate?: P },
  options?: CallOptions,
) => ContractResultPromise<Page<Populated<E, C, P[number]>>, Errors>;

type SliceClient<E extends Entries, S extends keyof E> = ContractClient<
  Contract<E>
>[S & keyof ContractClient<Contract<E>>];

/**
 * ts-pf's client, with `get` and `find` generic in `populate`. A collection
 * with no relations keeps ts-pf's, which has no `populate`.
 */
export type LatticeClient<E extends Entries> = {
  [S in keyof E]: [PopulateKey<E[S]>] extends [never]
    ? SliceClient<E, S>
    : Omit<SliceClient<E, S>, 'get' | 'find'> & {
        get: GetClient<E, E[S]>;
        find: FindClient<E, E[S]>;
      };
};

// ---------------------------------------------------------------- framework

type Unresolved<E extends Entries> = {
  [S in keyof E]:
    | {
        [K in keyof RefFields<E[S]>]: RefFields<E[S]>[K] extends keyof E
          ? never
          : `${S & string}.${K & string} refers to "${RefFields<E[S]>[K]}"`;
      }[keyof RefFields<E[S]>]
    | {
        [R in keyof E[S]['relations']]: E[S]['relations'][R]['target'] extends keyof E
          ? never
          : `${S & string}.${R & string} refers to "${E[S]['relations'][R]['target']}"`;
      }[keyof E[S]['relations']];
}[keyof E];

// Every ref must name a collection of this framework. Checked at build():
// collections may be added in any order, so refs may point both ways.
type RefCheck<E extends Entries> = [Unresolved<E>] extends [never]
  ? unknown
  : {
      readonly '~error': `${Unresolved<E>}, which is not a collection of this framework`;
    };

function refFields(col: AnyCol): [string, string][] {
  return Object.entries(col.schema.shape).flatMap(([name, field]) => {
    let schema: z.core.$ZodType = field;
    while (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
      schema = schema.unwrap();
    }
    return '~ref' in schema && typeof schema['~ref'] === 'string'
      ? [[name, schema['~ref']]]
      : [];
  });
}

type RuntimeProcedure = ContractProcedure<unknown, unknown, Declared>;

// A relation's `list` and `set` sit one level down. The spike builds no
// runtime for them: its tests are type-only.
type RuntimeContract = Record<
  string,
  Record<string, RuntimeProcedure | Record<string, RuntimeProcedure>>
>;

export class Framework<Actor, E extends Entries> {
  constructor(
    readonly family: SpikeFamily<Actor>,
    private readonly entries: readonly AnyCol[],
  ) {}

  /**
   * Adds a collection and its access functions. Access attaches here, like
   * methods (0018): only here are the actor and the document both known.
   */
  collection<
    C extends AnyCol,
    const R extends { [A in keyof R]: Allowed<A, Doc<C>> } = Record<
      never,
      never
    >,
  >(
    collection: C,
    _options?: {
      readonly access?: AccessFns<Actor, R, Doc<C>>;
    } & AccessCheck<R, Doc<C>, C['slug']>,
  ): Framework<Actor, E & Record<C['slug'], C>> {
    return new Framework<Actor, E & Record<C['slug'], C>>(this.family, [
      ...this.entries,
      collection,
    ]);
  }

  get contract(): Contract<E> {
    return contractOf<E>(this.entries);
  }

  /** The spike's build: the router only, every handler unimplemented. */
  build(_options: { readonly store: unknown } & RefCheck<E>): {
    readonly app: ImplementedRouter<Contract<E>, FamilyContext<Actor>>;
  } {
    return { app: implement<E, FamilyContext<Actor>>(this.contract) };
  }

  /**
   * Option (c): the same client, typed so reads follow `populate`. The
   * overload states the type; the client is returned unchanged.
   */
  client(client: ContractClient<Contract<E>>): LatticeClient<E>;
  client(client: object): object {
    return client;
  }
}

function contractOf<E extends Entries>(entries: readonly AnyCol[]): Contract<E>;
function contractOf(entries: readonly AnyCol[]): RuntimeContract {
  const call = procedure.errors(declaredErrors);
  const outputs = new Map(entries.map((col) => [col.slug, col.output]));
  const withheld = z.object({ id: z.string() });
  const slices: RuntimeContract = {};
  for (const col of entries) {
    const refs = refFields(col);
    const keys = [...refs.map(([name]) => name), ...Object.keys(col.relations)];
    const populate =
      keys.length === 0 ? {} : { populate: z.array(z.enum(keys)).optional() };
    // One output for every call: a ref field may hold its target document.
    const wide = col.output.extend(
      Object.fromEntries(
        refs.map(([name, slug]) => [
          name,
          z.union([z.string(), outputs.get(slug) ?? z.never(), withheld]),
        ]),
      ),
    );
    const id = z.object({ id: z.string() });
    slices[col.slug] = {
      get: call.input(id.extend(populate)).output(wide),
      find: call
        .input(z.object({ limit: z.number().optional(), ...populate }))
        .output(z.object({ docs: z.array(wide), next: z.string().nullable() })),
      create: call.input(col.schema).output(col.output),
      update: call
        .input(col.schema.partial().extend(id.shape))
        .output(col.output),
      delete: call.input(id).output(col.output),
    };
  }
  return router(slices);
}

function implement<E extends Entries, Ctx>(
  contract: Contract<E>,
): ImplementedRouter<Contract<E>, Ctx>;
function implement(
  contract: RuntimeContract,
): ImplementedRouter<RuntimeContract, unknown> {
  const impl = createImplementer(contract).$context<unknown>();
  const tree: Record<
    string,
    Record<string, ImplementedProcedure<RuntimeProcedure, unknown>>
  > = {};
  for (const [slug, slice] of Object.entries(contract)) {
    const sliceTree: (typeof tree)[string] = {};
    for (const name of Object.keys(slice)) {
      const builder = impl[slug]?.[name];
      if (builder === undefined) continue;
      sliceTree[name] = builder.handler(() => {
        throw new Error(`spike: ${slug}.${name} is not implemented`);
      });
    }
    tree[slug] = sliceTree;
  }
  return impl.router(tree);
}

export function framework<Actor>(options: {
  readonly family: SpikeFamily<Actor>;
}): Framework<Actor, Record<never, never>> {
  return new Framework(options.family, []);
}
