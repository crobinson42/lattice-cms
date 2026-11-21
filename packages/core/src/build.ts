import type { Logger } from '@hexok/logger';
import {
  type ContractProcedure,
  type ContractRouterBrand,
  type ErrorMap,
  type Expansion,
  type InferContractProcedure,
  type InferExpandedOutput,
  type InferSchemaInput,
  type InferSchemaOutput,
  isContractProcedure,
  procedure,
  router,
} from '@ts-pf/contract';
import { isPFError, isUnexpectedError } from '@ts-pf/protocol';
import {
  createImplementer,
  type ImplementedProcedure,
  type ImplementedRouter,
  isImplementedProcedure,
  type MiddlewareFn,
} from '@ts-pf/server';
import { validate } from 'hexok';
import { z } from 'zod';
import {
  type Access,
  type AccessCheck,
  type AccessFns,
  type AccessMap,
  type AccessReturns,
  CollectionAccess,
  familyContext,
} from './access.js';
import {
  type Action,
  type AnyCollection,
  type AnyRelation,
  type Operations,
  operations,
} from './collection.js';
import {
  type EventPublisher,
  type Executable,
  generated,
  generatedRelation,
} from './crud.js';
import {
  declaredErrors,
  type LatticeCode,
  latticeCodes,
  refusal,
  toClientError,
} from './errors.js';
import {
  type CallContext,
  callerFields,
  type Family,
  type FamilyContext,
  loggedByFamily,
} from './family.js';
import {
  expansionOf,
  populateKeys,
  populateShape,
  type Withheld,
} from './populate.js';
import { type CascadeFields, type RefSlugs, referrersOf } from './relations.js';
import { type Doc, type Repo, repo } from './repo.js';
import type { CollectionStore } from './store.js';
import type { TenantField } from './tenancy.js';

const actions = [
  'find',
  'count',
  'get',
  'create',
  'update',
  'delete',
] as const satisfies readonly Action[];

// ts-pf `Implementer` keys. A slug or method name with one of these names
// would shadow the implementer's own member when the router is built.
const reserved = [
  '$context',
  'use',
  'useAfter',
  'middleware',
  'router',
] as const;
type Reserved = (typeof reserved)[number];

type Ctor<I> = abstract new (...args: never[]) => I;

type Schemas = { readonly input: z.ZodType; readonly output: z.ZodType };

/** An override as declared: a class, or one per operation of a relation. */
type AnyOverride = Ctor<unknown> | Readonly<Record<string, Ctor<unknown>>>;

/**
 * A collection, its access functions, and the classes attached to it. A
 * join collection a relation derived is an entry too, so its events, refs
 * and indexes count, but it has no slice and no use cases.
 */
type Entry = {
  readonly collection: AnyCollection;
  readonly access: AccessMap;
  readonly methods: Readonly<Record<string, Ctor<unknown> & Schemas>>;
  readonly overrides: Readonly<Record<string, AnyOverride>>;
  readonly join: boolean;
};

/** The relation operations Lattice generates. */
const relationOps = ['list', 'set'] as const;
type RelationOp = (typeof relationOps)[number];

/** The entries a collection's relations add: their join collections. */
type JoinEntries<C extends AnyCollection> = {
  [K in keyof C['relations'] as C['relations'][K]['through']['slug']]: {
    collection: C['relations'][K]['through'];
    methods: Record<never, never>;
    overrides: Record<never, never>;
    join: true;
  };
};

/** The entries with a contract slice: all but join collections. */
type Sliced<E extends Entries> = {
  [S in keyof E as E[S]['join'] extends true ? never : S]: E[S];
};

type Entries = Record<string, Entry>;

type Ops<Col extends AnyCollection> = Operations<
  Col['schema']['shape'],
  TenantField<Col>
>;

/**
 * What a class attached as method `N` of `Col` must be: its statics name
 * `Col` and `<slug>.<N>`, and `execute` takes and returns its own schemas'
 * types. `execute` is a property here, not a method, so its input is checked
 * contravariantly: a method signature is bivariant and would accept a
 * narrower input.
 */
type MethodCheck<C, Col extends AnyCollection, N, Ctx> = N extends
  | Action
  | 'read'
  | Reserved
  | keyof Col['relations']
  | `${string}.${string}`
  ? Ctor<unknown> &
      Schemas & {
        readonly '~error': `"${N & string}" is a generated operation, an access key, a relation, a ts-pf implementer key, or has a dot`;
      }
  : C extends {
        readonly input: infer I extends z.ZodType;
        readonly output: infer O extends z.ZodType;
      }
    ? Ctor<{
        execute: (ctx: Ctx, input: z.output<I>) => Promise<z.output<O>>;
      }> & {
        readonly token: `${Col['slug']}.${N & string}`;
        readonly collection: Col;
        readonly input: I;
        readonly output: O;
      }
    : Ctor<unknown> & Schemas;

/** What a class that replaces relation operation `Op` of `Col.R` must be. */
type RelationOverrideCheck<
  Col extends AnyCollection,
  R extends keyof Col['relations'],
  Op extends RelationOp,
  Ctx,
> = Ctor<{
  execute: (
    ctx: Ctx,
    input: z.output<Col['relations'][R][Op]['input']>,
  ) => Promise<z.output<Col['relations'][R][Op]['output']>>;
}> & {
  readonly token: `${Col['slug']}.${R & string}.${Op}`;
  readonly collection: Col;
};

/**
 * What a class that replaces operation `A` of `Col` must be. A relation's
 * operations are replaced by name: `{ categories: { set: Class } }`.
 */
type OverrideCheck<Col extends AnyCollection, A, Ctx> = A extends Action
  ? Ctor<{
      execute: (
        ctx: Ctx,
        input: z.output<Ops<Col>[A]['input']>,
      ) => Promise<z.output<Ops<Col>[A]['output']>>;
    }> & {
      readonly token: `${Col['slug']}.${A}`;
      readonly collection: Col;
    }
  : A extends keyof Col['relations']
    ? {
        readonly [Op in RelationOp]?: RelationOverrideCheck<Col, A, Op, Ctx>;
      }
    : Ctor<unknown> & {
        readonly '~error': `"${A & string}" is not a generated operation or a relation`;
      };

// A rejected slug adds a key the collection lacks, so the error names it.
type SlugCheck<C extends AnyCollection, E extends Entries> = C extends {
  readonly slug: Reserved;
}
  ? { readonly '~error': `"${C['slug']}" is a ts-pf implementer key` }
  : C['slug'] extends keyof E
    ? { readonly '~error': `"${C['slug']}" is already a collection` }
    : [keyof JoinEntries<C> & (keyof E | C['slug'])] extends [never]
      ? unknown
      : {
          readonly '~error': `the join collection "${keyof JoinEntries<C> & (keyof E | C['slug']) & string}" is already a collection`;
        };

// A tenanted collection needs a family with tenantOf. A rejected collection
// adds a key it lacks, so the error names it.
type TenantCheck<C extends AnyCollection, Tenanted extends boolean> = [
  TenantField<C>,
] extends [never]
  ? unknown
  : [Tenanted] extends [false]
    ? {
        readonly '~error': `"${C['slug']}" is tenanted, but the family has no tenantOf`;
      }
    : unknown;

// A cascade deletes children on Lattice's own path, so a collection that
// overrides delete, such as with a soft delete, would lose rows it keeps.
// A rejected collection adds a key its options lack, so the error names the
// field.
type CascadeOverrideCheck<C extends AnyCollection, O> = 'delete' extends keyof O
  ? [CascadeFields<C['schema']['shape']>] extends [never]
    ? unknown
    : {
        readonly '~error': `${C['slug']} overrides delete, so ${C['slug']}.${CascadeFields<C['schema']['shape']> & string} cannot cascade; use restrict or nullify`;
      }
  : unknown;

// Each event of `Col` that `P.publish` does not take, by token.
type Refused<Col extends AnyCollection, P extends EventPublisher> = {
  [K in keyof Col['events']]: [Instance<Col['events'][K]>] extends [
    Parameters<P['publish']>[0],
  ]
    ? never
    : Instance<Col['events'][K]> extends { readonly token: infer T }
      ? T
      : never;
}[keyof Col['events']];

// Each event of every collection in `E` that `P.publish` does not take.
type RefusedBy<E extends Entries, P extends EventPublisher> = {
  [S in keyof E]: Refused<E[S]['collection'], P>;
}[keyof E];

// Checked as a tuple, not through `P extends { publish(...) }`: publish is
// usually a method, and a method's parameter is bivariant, so a publisher of
// another catalog's events would pass. A rejected publisher adds a key it
// lacks, so the error names each token.
type EventsCheck<E extends Entries, P extends EventPublisher> = [
  RefusedBy<E, P>,
] extends [never]
  ? unknown
  : {
      readonly '~error': `the events publisher does not take "${RefusedBy<E, P> & string}"`;
    };

// A rejected map adds a key it lacks, so the error names the code.
type DeclaredCheck<D> = [keyof D & LatticeCode] extends [never]
  ? unknown
  : {
      readonly '~error': `"${keyof D & LatticeCode & string}" is a Lattice error code`;
    };

/** The errors every procedure declares: Lattice's, then the app's. */
type Declared<D extends ErrorMap> = typeof declaredErrors & D;

/**
 * A procedure as ts-pf's `procedure.input(In).output(Out)` types it: a
 * caller sends the input schema's input type, so a defaulted field is
 * optional, and the handler receives its output type.
 */
type Procedure<In, Out, D extends ErrorMap> = ContractProcedure<
  InferSchemaInput<In>,
  InferSchemaOutput<Out>,
  Declared<D>,
  Record<never, never>,
  InferSchemaOutput<In>
>;

type Flat<T> = { [K in keyof T]: T[K] } & {};

/** The ref fields of `Col`, and the slug each refers to. */
type RefsOf<Col extends AnyCollection> = RefSlugs<Col['schema']['shape']>;

/** A read that populates: `get` takes refs and relations, `find` refs only. */
type PopulatingRead = 'get' | 'find';

/** The `many()` relations a read of `Col` may populate. */
type RelationsOf<
  Col extends AnyCollection,
  R extends PopulatingRead,
> = R extends 'get' ? keyof Col['relations'] : never;

/**
 * What `populate` may name on read `R` of `Col`. A template literal, so an
 * error prints the union rather than the alias.
 */
type PopulateKey<
  Col extends AnyCollection,
  R extends PopulatingRead,
> = `${(keyof RefsOf<Col> | RelationsOf<Col, R>) & string}`;

/** A populated ref's document: the target's, or `Withheld`. */
type Target<E extends Entries, Slug> =
  | (Slug extends keyof E ? Doc<E[Slug]['collection']> : never)
  | Withheld;

/** A ref field's expanded type, one target or a list. Null and undefined stay the field's own. */
type Swap<V, T> = V extends string
  ? T
  : V extends readonly string[]
    ? T[]
    : never;

/** A populated link of `Rel`: its fields and its target document. */
type Link<E extends Entries, Rel extends AnyRelation> = Flat<
  Omit<
    Doc<Rel['through']>,
    | 'id'
    | 'createdAt'
    | 'updatedAt'
    | Rel['parentField']
    | Rel['targetField']
    | TenantField<Rel['through']>
  > & { doc: Target<E, Rel['target']> }
>;

/** Each ref field of `Col`, populated. */
type ExpandedRefs<E extends Entries, Col extends AnyCollection> = {
  [K in keyof RefsOf<Col>]: Swap<
    Doc<Col>[K & keyof Doc<Col>],
    Target<E, RefsOf<Col>[K]>
  >;
};

/** Each relation read `R` of `Col` may populate, as its links. */
type ExpandedLinks<
  E extends Entries,
  Col extends AnyCollection,
  R extends PopulatingRead,
> = {
  [N in RelationsOf<Col, R>]: Link<E, Col['relations'][N]>[];
};

/** What `populate` gives on read `R` of `Col`: the expansion's `fields`. */
type Expanded<
  E extends Entries,
  Col extends AnyCollection,
  R extends PopulatingRead,
> = Flat<ExpandedRefs<E, Col> & ExpandedLinks<E, Col, R>>;

/**
 * `Col`'s document as read `R` sends it: each ref field plain or
 * populated, and each relation only when populated.
 */
type Wide<
  E extends Entries,
  Col extends AnyCollection,
  R extends PopulatingRead,
> = Flat<
  {
    [K in keyof Doc<Col>]: K extends keyof ExpandedRefs<E, Col>
      ? Doc<Col>[K] | ExpandedRefs<E, Col>[K]
      : Doc<Col>[K];
  } & Partial<ExpandedLinks<E, Col, R>>
>;

/**
 * A read of `Col`, as `contractOf` builds it: its output follows `populate`
 * through ts-pf's expandable outputs (0022), at the root (`get`) or in
 * `docs` (`find`, `list`). Plain when `Col` has no ref field.
 */
type Read<
  E extends Entries,
  Col extends AnyCollection,
  In,
  R extends PopulatingRead,
  D extends ErrorMap,
> = [PopulateKey<Col, R>] extends [never]
  ? never
  : ContractProcedure<
      Flat<InferSchemaInput<In> & { populate?: PopulateKey<Col, R>[] }>,
      R extends 'get'
        ? Wide<E, Col, R>
        : { docs: Wide<E, Col, R>[]; next: string | null },
      Declared<D>,
      Record<never, never>,
      Flat<
        InferSchemaOutput<In> & {
          populate?: PopulateKey<Col, R>[] | undefined;
        }
      >,
      Expansion<
        'populate',
        R extends 'get' ? [] : ['docs'],
        Expanded<E, Col, R>
      >
    >;

/** `Read`, or the plain procedure when there is nothing to populate. */
type ReadOr<
  E extends Entries,
  Col extends AnyCollection,
  In,
  Out,
  R extends PopulatingRead,
  D extends ErrorMap,
> = [Read<E, Col, In, R, D>] extends [never]
  ? Procedure<In, Out, D>
  : Read<E, Col, In, R, D>;

/**
 * Generated operation `A` of entry `S`. An overridden read is plain: the
 * override serves it, and Lattice's population runs in the generated read.
 */
type Operation<
  E extends Entries,
  S extends Entry,
  A extends Action,
  D extends ErrorMap,
> = A extends 'get' | 'find'
  ? A extends keyof S['overrides']
    ? Procedure<
        Ops<S['collection']>[A]['input'],
        Ops<S['collection']>[A]['output'],
        D
      >
    : ReadOr<
        E,
        S['collection'],
        Ops<S['collection']>[A]['input'],
        Ops<S['collection']>[A]['output'],
        A,
        D
      >
  : Procedure<
      Ops<S['collection']>[A]['input'],
      Ops<S['collection']>[A]['output'],
      D
    >;

/** Operation `Op` of relation `R` of entry `S`. An overridden list is plain. */
type RelationOperation<
  E extends Entries,
  S extends Entry,
  R extends keyof S['collection']['relations'],
  Op extends RelationOp,
  D extends ErrorMap,
> = Op extends 'list'
  ? R extends keyof S['overrides']
    ? 'list' extends keyof S['overrides'][R]
      ? Procedure<
          S['collection']['relations'][R]['list']['input'],
          S['collection']['relations'][R]['list']['output'],
          D
        >
      : RelationList<E, S, R, D>
    : RelationList<E, S, R, D>
  : Procedure<
      S['collection']['relations'][R][Op]['input'],
      S['collection']['relations'][R][Op]['output'],
      D
    >;

type RelationList<
  E extends Entries,
  S extends Entry,
  R extends keyof S['collection']['relations'],
  D extends ErrorMap,
> = ReadOr<
  E,
  S['collection']['relations'][R]['through'],
  S['collection']['relations'][R]['list']['input'],
  S['collection']['relations'][R]['list']['output'],
  'find',
  D
>;

/** One collection's contract slice: the generated operations plus its methods. */
type Slice<E extends Entries, S extends Entry, D extends ErrorMap> = {
  [K in Action | (keyof S['methods'] & string)]: K extends Action
    ? Operation<E, S, K, D>
    : Procedure<S['methods'][K]['input'], S['methods'][K]['output'], D>;
} & {
  [R in keyof S['collection']['relations']]: {
    [Op in RelationOp]: RelationOperation<E, S, R, Op, D>;
  };
};

/** Each ref whose slug is not a collection of `E`, as `slug.field → target`. */
type Unresolved<E extends Entries> = {
  [S in keyof E]: {
    [K in keyof RefSlugs<E[S]['collection']['schema']['shape']>]: RefSlugs<
      E[S]['collection']['schema']['shape']
    >[K] extends keyof E
      ? never
      : `${S & string}.${K & string} refers to "${RefSlugs<E[S]['collection']['schema']['shape']>[K] & string}"`;
  }[keyof RefSlugs<E[S]['collection']['schema']['shape']>];
}[keyof E];

// Collections may be added in any order, so refs can point both ways: they
// are checked where the definition is used, on `contract` and `build()`. A
// rejected definition gains a key, so the error names each ref.
type SlugsCheck<E extends Entries> = [Unresolved<E>] extends [never]
  ? unknown
  : {
      readonly '~error': `${Unresolved<E>}, which is not a collection of this framework`;
    };

/** The generated ts-pf contract: one slice per collection. */
export type Contract<E extends Entries, D extends ErrorMap> = {
  [S in keyof Sliced<E>]: Slice<E, E[S], D>;
} & ContractRouterBrand;

/** The contract as `.contract` gives it: with an `'~error'` key while a ref is unresolved. */
type CheckedContract<E extends Entries, D extends ErrorMap> = Contract<E, D> &
  SlugsCheck<E>;

type Instance<C> = C extends Ctor<infer I> ? I : never;

/** The instance of a declared class, or of each relation operation's. */
type InstanceOf<V, Ctx> =
  V extends Ctor<infer I>
    ? I & Executable<Ctx>
    : { [Op in keyof V]: Instance<V[Op]> & Executable<Ctx> };

type Instances<E extends Entries, Kind extends 'methods' | 'overrides', Ctx> = {
  [S in keyof E as [keyof E[S][Kind]] extends [never] ? never : S]: {
    [N in keyof E[S][Kind]]: InstanceOf<E[S][Kind][N], Ctx>;
  };
};

/** Each collection's repo, by slug. */
type Repos<E extends Entries> = { [S in keyof E]: Repo<E[S]['collection']> };

/** What an instance factory receives: what exists before the use cases. */
type Wiring<E extends Entries> = { readonly repos: Repos<E> };

/**
 * One kind of instance `build()` takes: a factory that returns one instance
 * per attached class, by slug and name. Required when a collection declared
 * that kind.
 */
type Factory<E extends Entries, Kind extends 'methods' | 'overrides', Ctx> = [
  keyof Instances<E, Kind, Ctx>,
] extends [never]
  ? { readonly [K in Kind]?: (wiring: Wiring<E>) => Record<never, never> }
  : {
      readonly [K in Kind]: (wiring: Wiring<E>) => Instances<E, Kind, Ctx>;
    };

/** What `build()` takes: the ports, and the method and override instances. */
type BuildOptions<E extends Entries, P extends EventPublisher, Actor, Ctx> = {
  /**
   * Where every collection's documents live. A ref to a slug the definition
   * lacks is reported here, because the store is what every ref needs.
   */
  readonly store: CollectionStore & SlugsCheck<E>;
  /**
   * Decides access instead of the functions given at `.collection()`, such
   * as an adapter of another decision engine.
   */
  readonly access?: Access<Actor>;
  /**
   * The app's domain event publisher. Generated writes publish each
   * collection's events through it. An app with no subscribers passes one
   * that does nothing.
   */
  readonly events: P & EventsCheck<E, P>;
} & Factory<E, 'methods', Ctx> &
  Factory<E, 'overrides', Ctx>;

/**
 * A generated use case as a direct caller sees it. Its `execute` parses its
 * own input, so it takes the schema's input type: defaulted fields may be
 * left out.
 */
type GeneratedUseCase<Col extends AnyCollection, A extends Action, Ctx> = {
  execute(
    ctx: Ctx,
    input: z.input<Ops<Col>[A]['input']>,
  ): Promise<z.output<Ops<Col>[A]['output']>>;
};

/** A generated relation operation as a direct caller sees it. */
type GeneratedRelationUseCase<Schemas_ extends Schemas, Ctx> = {
  execute(
    ctx: Ctx,
    input: z.input<Schemas_['input']>,
  ): Promise<z.output<Schemas_['output']>>;
};

/**
 * A generated read as a direct caller sees it: its output follows
 * `populate`, as a client's does.
 */
// An interface, so a declaration file names it rather than spelling out
// ts-pf's ExpandResult, which @ts-pf/contract does not export.
export interface ReadUseCase<Proc, Ctx> {
  execute<const P extends readonly ExpansionKeys<Proc>[] = readonly []>(
    ctx: Ctx,
    input: InferContractProcedure<Proc>['input'] & { readonly populate?: P },
  ): Promise<InferExpandedOutput<Proc, P>>;
}

// ts-pf's InferExpansionKeys, which it does not export. The same type, so it
// satisfies InferExpandedOutput's constraint.
type ExpansionKeys<T> =
  InferContractProcedure<T>['expand'] extends infer X extends Expansion
    ? keyof X['fields'] & string
    : never;

/** The use case of generated operation `A`: a populating read, or plain. */
type OperationUseCase<
  E extends Entries,
  S extends Entry,
  A extends Action,
  Ctx,
> = [InferContractProcedure<Operation<E, S, A, ErrorMap>>['expand']] extends [
  never,
]
  ? GeneratedUseCase<S['collection'], A, Ctx>
  : ReadUseCase<Operation<E, S, A, ErrorMap>, Ctx>;

/** The instances of one collection's relation operations. */
type RelationUseCases<E extends Entries, S extends Entry, Ctx> = {
  [R in keyof S['collection']['relations']]: {
    [Op in RelationOp]: R extends keyof S['overrides']
      ? Op extends keyof S['overrides'][R]
        ? Instance<S['overrides'][R][Op]>
        : RelationUseCase<E, S, R, Op, Ctx>
      : RelationUseCase<E, S, R, Op, Ctx>;
  };
};

/** The generated use case of relation operation `Op`: list populates. */
type RelationUseCase<
  E extends Entries,
  S extends Entry,
  R extends keyof S['collection']['relations'],
  Op extends RelationOp,
  Ctx,
> = Op extends 'list'
  ? ReadUseCase<RelationList<E, S, R, ErrorMap>, Ctx>
  : GeneratedRelationUseCase<S['collection']['relations'][R][Op], Ctx>;

/** The instance that serves each procedure: generated, override or method. */
type UseCases<E extends Entries, Ctx> = {
  [S in keyof Sliced<E>]: {
    [A in Action]: A extends keyof E[S]['overrides']
      ? Instance<E[S]['overrides'][A]>
      : OperationUseCase<E, E[S], A, Ctx>;
  } & {
    [N in keyof E[S]['methods']]: Instance<E[S]['methods'][N]>;
  } & RelationUseCases<E, E[S], Ctx>;
};

/** What `build()` returns. */
type Built<E extends Entries, D extends ErrorMap, Actor> = {
  readonly app: ImplementedRouter<Contract<E, D>, CallContext<Actor>>;
  readonly useCases: UseCases<E, FamilyContext<Actor>>;
  readonly repos: Repos<E>;
  readonly onError: typeof unexpectedErrors;
  /**
   * Creates the indexes each collection declares, collection by collection
   * in definition order, and never drops one. Await it after the store has
   * started and before serving.
   */
  readonly ensure: () => Promise<void>;
  /**
   * The context for a direct `useCases.*.execute` call: the caller's, plus
   * the call's access. Access answers are kept on it, so make one per call
   * or per job.
   */
  readonly context: (base: CallContext<Actor>) => FamilyContext<Actor>;
};

/** Any procedure of the contract, a populated read's expansion included. */
type RuntimeProcedure = ContractProcedure<
  unknown,
  unknown,
  ErrorMap,
  Record<never, never>,
  unknown,
  Expansion
>;

/** A relation's node in a slice: its `list` and `set` procedures. */
type RuntimeRelation = Record<string, RuntimeProcedure>;

type RuntimeContract = Record<
  string,
  Record<string, RuntimeProcedure | RuntimeRelation>
>;

/** Whether a slice's node is a procedure, not a relation's node. */
function isProcedure(
  node: RuntimeProcedure | RuntimeRelation,
): node is RuntimeProcedure {
  return isContractProcedure(node);
}

/** The app's client errors: its declared map, and the mapper that builds them. */
type AppErrors<D extends ErrorMap> = {
  readonly declared: D;
  /** Returns the error a client receives. ts-pf sends one it returns unchanged as INTERNAL. */
  readonly map: (error: unknown) => unknown;
};

/** Instances by slug and name; a relation's by slug, relation and operation. */
type RuntimeInstances<Ctx> = Readonly<
  Record<
    string,
    | Readonly<
        Record<
          string,
          Executable<Ctx> | Readonly<Record<string, Executable<Ctx>>>
        >
      >
    | undefined
  >
>;

/**
 * A factory as the implementation of `build()` reads it. A method
 * signature, so its parameter compares bivariantly with the precise
 * factory the overload states.
 */
type FactoryFn<Actor> = {
  factory(wiring: RuntimeWiring): RuntimeInstances<FamilyContext<Actor>>;
}['factory'];

type RuntimeWiring = {
  readonly repos: Readonly<Record<string, Repo<AnyCollection>>>;
};

/**
 * An app's definition: its family, its error map and its collections, with
 * the methods and overrides attached to them. It holds no ports, so its
 * `contract` needs no store and no publisher. `build()` wires it.
 */
export class Framework<
  Actor,
  D extends ErrorMap,
  E extends Entries,
  Tenanted extends boolean = boolean,
> {
  #contract: CheckedContract<E, D> | undefined;

  constructor(
    private readonly family: Family<Actor, Tenanted>,
    private readonly errors: AppErrors<ErrorMap>,
    private readonly entries: readonly Entry[],
  ) {}

  /**
   * Adds a collection, and the methods and overrides attached to it. Its slug
   * becomes its contract slice.
   */
  collection<
    C extends AnyCollection,
    const R extends AccessReturns<R, C>,
    M extends {
      [N in keyof M]: MethodCheck<M[N], C, N, FamilyContext<Actor>>;
    } = Record<never, never>,
    O extends {
      [A in keyof O]: OverrideCheck<C, A, FamilyContext<Actor>>;
    } = Record<never, never>,
  >(
    collection: C & SlugCheck<C, E> & TenantCheck<C, Tenanted>,
    options: {
      /**
       * Who may do what (0021): `read` (find and get), `create`, `update`,
       * `delete`, and one per method. A missing function denies.
       */
      readonly access: AccessFns<Actor, R, C>;
      readonly methods?: M;
      readonly overrides?: O;
    } & AccessCheck<R, M, C> &
      CascadeOverrideCheck<C, O>,
  ): Framework<
    Actor,
    D,
    E &
      Record<
        C['slug'],
        { collection: C; methods: M; overrides: O; join: false }
      > &
      JoinEntries<C>,
    Tenanted
  > {
    const { slug } = collection;
    if (collection.tenant !== undefined && this.family.tenantOf === undefined) {
      throw new Error(
        `Lattice: "${slug}" is tenanted, but the family has no tenantOf`,
      );
    }
    if (reserved.some((key) => key === slug)) {
      throw new Error(`Lattice: "${slug}" is a ts-pf implementer key`);
    }
    if (this.entries.some((entry) => entry.collection.slug === slug)) {
      throw new Error(`Lattice: "${slug}" is already a collection`);
    }
    const relations = Object.entries(collection.relations);
    const joins = relations.map(([, relation]) => relation.through);
    for (const join of joins) {
      if (
        join.slug === slug ||
        this.entries.some((entry) => entry.collection.slug === join.slug) ||
        joins.filter((other) => other.slug === join.slug).length > 1
      ) {
        throw new Error(
          `Lattice: the join collection "${join.slug}" is already a collection`,
        );
      }
    }
    for (const [name] of relations) {
      if (reserved.some((key) => key === name)) {
        throw new Error(
          `Lattice: relation "${slug}.${name}" is a ts-pf implementer key`,
        );
      }
    }
    const methods: Entry['methods'] = options.methods ?? {};
    for (const name of Object.keys(methods)) {
      if (
        [...reserved, ...actions, 'read'].some((key) => key === name) ||
        relations.some(([relation]) => relation === name) ||
        name.includes('.')
      ) {
        throw new Error(`Lattice: "${slug}.${name}" cannot be a method name`);
      }
    }
    const overrides: Entry['overrides'] = options.overrides ?? {};
    const cascading = collection.refs.find((ref) => ref.onDelete === 'cascade');
    if (overrides.delete !== undefined && cascading !== undefined) {
      throw new Error(
        `Lattice: ${slug} overrides delete, so ${slug}.${cascading.field} cannot cascade; use restrict or nullify`,
      );
    }
    // A relation's list runs the parent's read, and its set the parent's
    // update (0028).
    const declared: AccessMap = options.access;
    const access: AccessMap = Object.fromEntries([
      ...Object.entries(declared),
      ...relations.flatMap(([name]): [string, AccessMap[string]][] => [
        ...(declared.read === undefined
          ? []
          : [
              [`${name}.list`, declared.read] satisfies [
                string,
                AccessMap[string],
              ],
            ]),
        ...(declared.update === undefined
          ? []
          : [
              [`${name}.set`, declared.update] satisfies [
                string,
                AccessMap[string],
              ],
            ]),
      ]),
    ]);
    for (const action of Object.keys(overrides)) {
      if (
        !actions.some((key) => key === action) &&
        !relations.some(([relation]) => relation === action)
      ) {
        throw new Error(
          `Lattice: "${slug}.${action}" is not a generated operation or a relation`,
        );
      }
    }
    return new Framework<
      Actor,
      D,
      E &
        Record<
          C['slug'],
          { collection: C; methods: M; overrides: O; join: false }
        > &
        JoinEntries<C>,
      Tenanted
    >(this.family, this.errors, [
      ...this.entries,
      { collection, access, methods, overrides, join: false },
      ...joins.map((join) => ({
        collection: join,
        access: {},
        methods: {},
        overrides: {},
        join: true,
      })),
    ]);
  }

  /**
   * The ts-pf contract: one slice per collection. Built on first read and
   * the same object after, so clients and codegen import it with no ports.
   */
  get contract(): CheckedContract<E, D> {
    checkSlugs(this.entries);
    this.#contract ??= contractOf<E, D>(this.entries, this.errors.declared);
    return this.#contract;
  }

  /**
   * Wires the definition to its ports: the implemented router, the use
   * cases, the repos, and the edge's `onError`. `methods` and `overrides`
   * build the declared instances from the repos. The overload states the
   * precise types; the implementation works on the runtime shape, which a
   * loop over collections cannot express as a mapped type.
   */
  build<P extends EventPublisher>(
    options: BuildOptions<E, P, Actor, FamilyContext<Actor>>,
  ): Built<E, D, Actor>;
  build(options: {
    readonly store: CollectionStore;
    readonly events: EventPublisher;
    readonly access?: Access<Actor>;
    readonly methods?: FactoryFn<Actor>;
    readonly overrides?: FactoryFn<Actor>;
  }): {
    readonly app: ImplementedRouter<unknown, CallContext<Actor>>;
    readonly useCases: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    readonly repos: RuntimeWiring['repos'];
    readonly onError: typeof unexpectedErrors;
    readonly ensure: () => Promise<void>;
    readonly context: (base: CallContext<Actor>) => FamilyContext<Actor>;
  } {
    checkSlugs(this.entries);
    const { store, events } = options;
    const referrers = referrersOf(
      this.entries.map((entry) => entry.collection),
    );
    const collections = new Map(
      this.entries.map(({ collection }) => [collection.slug, collection]),
    );
    const access =
      options.access ??
      new CollectionAccess(
        new Map(
          this.entries.map((entry) => [entry.collection.slug, entry.access]),
        ),
      );
    const context = (base: CallContext<Actor>): FamilyContext<Actor> =>
      familyContext(access, base, this.family);
    const repos = Object.fromEntries(
      this.entries.map(({ collection }) => [
        collection.slug,
        repo(store, collection),
      ]),
    );
    const methodInstances = options.methods?.({ repos });
    const overrideInstances = options.overrides?.({ repos });
    type Ctx = FamilyContext<Actor>;
    // Each operation and method's use case, and each relation operation's,
    // by slug: the procedures of a slice and its nested relation nodes.
    const operationUseCases: Record<
      string,
      Record<string, Executable<Ctx>>
    > = {};
    const relationUseCases: Record<
      string,
      Record<string, Record<string, Executable<Ctx>>>
    > = {};
    for (const { collection, methods, overrides, join } of this.entries) {
      if (join) continue;
      const { slug } = collection;
      const sliceUseCases: Record<string, Executable<Ctx>> = {};
      const ops = operations(collection.schema, collection.output);
      for (const action of actions) {
        const declared = overrides[action];
        sliceUseCases[action] =
          typeof declared === 'function'
            ? instanceOf(
                'override',
                [slug, action],
                declared,
                overrideInstances,
              )
            : generated(
                this.family,
                store,
                events,
                collection,
                ops,
                action,
                referrers,
                collections,
              );
      }
      for (const [name, method] of Object.entries(methods)) {
        sliceUseCases[name] = instanceOf(
          'method',
          [slug, name],
          method,
          methodInstances,
        );
      }
      operationUseCases[slug] = sliceUseCases;
      const sliceRelations: Record<
        string,
        Record<string, Executable<Ctx>>
      > = {};
      for (const [name, relation] of Object.entries(collection.relations)) {
        const declared = overrides[name];
        const opUseCases: Record<string, Executable<Ctx>> = {};
        for (const op of relationOps) {
          const override =
            declared === undefined || typeof declared === 'function'
              ? undefined
              : declared[op];
          opUseCases[op] =
            override === undefined
              ? generatedRelation(
                  this.family,
                  store,
                  events,
                  collection,
                  name,
                  relation,
                  op,
                  collections,
                )
              : instanceOf(
                  'override',
                  [slug, name, op],
                  override,
                  overrideInstances,
                );
        }
        sliceRelations[name] = opUseCases;
      }
      relationUseCases[slug] = sliceRelations;
    }

    // One implementer per slice and per relation node, each typed by its own
    // procedures: ts-pf's types read a node that may be a procedure or a
    // router as a procedure. The root router places each procedure at its
    // path and checks the tree against the whole contract.
    const contract: RuntimeContract = this.contract;
    type Implemented = ImplementedProcedure<
      RuntimeProcedure,
      CallContext<Actor>
    >;
    const tree: Record<
      string,
      Record<string, Implemented | Record<string, Implemented>>
    > = {};
    const implement = (
      path: readonly string[],
      procedures: Readonly<Record<string, RuntimeProcedure>>,
      useCasesOf: Readonly<Record<string, Executable<Ctx>>> | undefined,
    ): Record<string, Implemented> => {
      const impl = createImplementer(procedures).$context<CallContext<Actor>>();
      const node: Record<string, Implemented> = {};
      for (const name of Object.keys(procedures)) {
        const builder = impl[name];
        const useCase = useCasesOf?.[name];
        if (builder === undefined || useCase === undefined) {
          throw new Error(
            `Lattice: no procedure "${[...path, name].join('.')}"`,
          );
        }
        // A fresh context per call: a createLocalClient context object is
        // shared by every call, and access answers are kept on the context.
        node[name] = builder.handler(({ input, context: base }) =>
          useCase.execute(context(base), input),
        );
      }
      return node;
    };
    for (const [slug, slice] of Object.entries(contract)) {
      const procedures: Record<string, RuntimeProcedure> = {};
      const nodes: Record<string, Record<string, RuntimeProcedure>> = {};
      for (const [name, node] of Object.entries(slice)) {
        if (isProcedure(node)) procedures[name] = node;
        else nodes[name] = node;
      }
      const sliceTree: Record<
        string,
        Implemented | Record<string, Implemented>
      > = implement([slug], procedures, operationUseCases[slug]);
      for (const [name, node] of Object.entries(nodes)) {
        sliceTree[name] = implement(
          [slug, name],
          node,
          relationUseCases[slug]?.[name],
        );
      }
      tree[slug] = sliceTree;
    }
    const useCases = Object.fromEntries(
      Object.entries(operationUseCases).map(([slug, sliceUseCases]) => [
        slug,
        { ...sliceUseCases, ...relationUseCases[slug] },
      ]),
    );
    const errors = clientErrors(this.family, this.errors.map);
    return {
      app: rootRouter<CallContext<Actor>>(
        createImplementer(contract).$context<CallContext<Actor>>().use(errors),
        tree,
      ),
      useCases,
      repos,
      onError: unexpectedErrors,
      ensure: async () => {
        for (const { collection } of this.entries) {
          if (collection.indexes.length === 0) continue;
          await store.ensure(collection.slug, collection.indexes);
        }
      },
      context,
    };
  }
}

/** Throws on a ref whose slug is not a collection of `entries`. */
function checkSlugs(entries: readonly Entry[]): void {
  const slugs = new Set(entries.map((entry) => entry.collection.slug));
  for (const { collection } of entries) {
    for (const { field, slug } of collection.refs) {
      if (!slugs.has(slug)) {
        throw new Error(
          `Lattice: ${collection.slug}.${field} refers to "${slug}", which is not a collection of this framework`,
        );
      }
    }
  }
}

/**
 * The contract of `entries`: Lattice's declared errors and the app's on
 * every procedure. The overload states its type; the implementation builds
 * it in a loop over collections, which a mapped type cannot express.
 */
function contractOf<E extends Entries, D extends ErrorMap>(
  entries: readonly Entry[],
  declared: ErrorMap,
): CheckedContract<E, D>;
function contractOf(
  entries: readonly Entry[],
  declared: ErrorMap,
): RuntimeContract {
  const call = procedure.errors({ ...declaredErrors, ...declared });
  const outputs = new Map(
    entries.map(({ collection }) => [collection.slug, collection.output]),
  );
  /** A page of `doc`s, as find and list return them. */
  const page = (doc: z.ZodObject) =>
    z.object({ docs: z.array(doc), next: z.string().nullable() });
  const slices: RuntimeContract = {};
  for (const { collection, methods, overrides, join } of entries) {
    if (join) continue;
    const slice: Record<string, RuntimeProcedure | RuntimeRelation> = {};
    const ops = operations(collection.schema, collection.output);
    for (const action of actions) {
      const { input, output } = ops[action];
      slice[action] = call.input(input).output(output);
    }
    // A read's output follows its `populate` list, through ts-pf's
    // expandable outputs (0022): the output is the wide document.
    // An overridden read is plain: Lattice populates in the generated one.
    if (
      overrides.get === undefined &&
      populateKeys(collection, 'get').length > 0
    ) {
      const { fields, wide } = expansionOf(collection, outputs, 'get');
      slice.get = call
        .input(
          ops.get.input.extend(populateShape(populateKeys(collection, 'get'))),
        )
        .output(wide)
        .expand({ key: 'populate', fields });
    }
    if (
      overrides.find === undefined &&
      populateKeys(collection, 'find').length > 0
    ) {
      const { fields, wide } = expansionOf(collection, outputs, 'find');
      slice.find = call
        .input(
          ops.find.input.extend(
            populateShape(populateKeys(collection, 'find')),
          ),
        )
        .output(page(wide))
        .expand({ key: 'populate', at: ['docs'], fields });
    }
    for (const [name, method] of Object.entries(methods)) {
      slice[name] = call.input(method.input).output(method.output);
    }
    for (const [name, relation] of Object.entries(collection.relations)) {
      const declared = overrides[name];
      const { fields, wide } = expansionOf(relation.through, outputs, 'find');
      slice[name] = {
        list:
          typeof declared === 'object' && declared.list !== undefined
            ? call.input(relation.list.input).output(relation.list.output)
            : call
                .input(relation.list.input)
                .output(page(wide))
                .expand({ key: 'populate', at: ['docs'], fields }),
        set: call.input(relation.set.input).output(relation.set.output),
      };
    }
    slices[collection.slug] = slice;
  }
  return router(slices);
}

/**
 * The edge's `onError`, such as `FetchHandler`'s: it logs each unexpected
 * error (ts-pf's `isUnexpectedError`) that no family logged as a failure. A
 * throw inside `execute` reaches the edge unchanged, and the family has
 * logged it once already. Logged here: a throw the family never saw, such as
 * the context factory's or ts-pf's output check, and a refusal the app's
 * map keeps from clients, which the family logged only at info. Typed
 * structurally, so core needs no `@ts-pf/server-http`: it fits
 * `FetchHandlerOnError`, which also passes the request.
 */
function unexpectedErrors(logger: Logger): (error: unknown) => void {
  return (error) => {
    if (!isUnexpectedError(error) || loggedByFamily(error) === 'failed') {
      return;
    }
    if (error instanceof Error) logger.error(error);
    else logger.error('Unexpected error', { thrown: error });
  };
}

/**
 * The instance passed to `build()` for one declared class. The type check is
 * structural, so it accepts a different class with the same members;
 * `instanceof` catches that here.
 */
function instanceOf<Ctx>(
  kind: 'method' | 'override',
  path: readonly [string, string] | readonly [string, string, string],
  declared: Ctor<unknown>,
  instances: RuntimeInstances<Ctx> | undefined,
): Executable<Ctx> {
  const [slug, name, op] = path;
  const found = instances?.[slug]?.[name];
  // A relation's instances are one more level down, by operation.
  const instance =
    op === undefined || found === undefined || isExecutable(found)
      ? found
      : found[op];
  const at = path.join('.');
  if (instance === undefined || !isExecutable(instance)) {
    throw new Error(`Lattice: no instance for ${kind} "${at}"`);
  }
  if (!(instance instanceof declared)) {
    throw new Error(
      `Lattice: "${at}" instance is not an instance of ${declared.name}`,
    );
  }
  return instance;
}

/** Whether a value is an implementer node, which has `router()`. */
function hasRouter(value: object): value is { router(tree: object): object } {
  return 'router' in value && typeof value.router === 'function';
}

/** Whether `value` is a finished router: procedures and routers, all the way down. */
function isRouter<Ctx>(
  value: unknown,
): value is ImplementedRouter<unknown, Ctx> {
  if (typeof value !== 'object' || value === null) return false;
  return Object.values(value).every(
    (node) => isImplementedProcedure(node) || isRouter(node),
  );
}

/**
 * The finished root router. The runtime contract's slice node is
 * `RuntimeProcedure | RuntimeRelation`, and ts-pf (0.6.0) types a node that
 * may be a procedure as one: `IsContractProcedure` of the union is true, so
 * `RouterImplCheck` wants an implemented procedure where a relation's
 * router sits. The root implementer's `router()` is therefore called
 * through its runtime shape. At runtime ts-pf still checks the tree against
 * the whole contract, sets each procedure's path and adds the root
 * middleware. Remove this when ts-pf's `RouterImplCheck` decides a mixed
 * node by the implementation's node, not the contract's.
 */
function rootRouter<Ctx>(
  implementer: object,
  tree: object,
): ImplementedRouter<unknown, Ctx> {
  if (!hasRouter(implementer)) {
    throw new Error('Lattice: the ts-pf implementer has no router()');
  }
  const app = implementer.router(tree);
  if (!isRouter<Ctx>(app)) {
    throw new Error('Lattice: ts-pf router() returned no router');
  }
  return app;
}

/** Whether an instance entry is a use case, not a relation's map of them. */
function isExecutable<Ctx>(
  value: Executable<Ctx> | Readonly<Record<string, Executable<Ctx>>>,
): value is Executable<Ctx> {
  return 'execute' in value && typeof value.execute === 'function';
}

/**
 * The middleware on every procedure. It replaces a thrown error with the one
 * the client receives (`toClientError`). It logs each refusal no family
 * logged, once, at info: a guard's, and ts-pf's own input check, which runs
 * after `.use()` middleware. An error sent as INTERNAL is the edge's
 * `onError` to log.
 */
function clientErrors<Actor>(
  family: Family<Actor>,
  map: (error: unknown) => unknown,
): MiddlewareFn<CallContext<Actor>> {
  return async ({ context, next, path }) => {
    try {
      return await next();
    } catch (error) {
      const sent = toClientError(error, map);
      if (
        isPFError(sent) &&
        sent.code !== 'INTERNAL' &&
        loggedByFamily(error) === undefined
      ) {
        const [collection, action] = path;
        // The guards may not have checked the actor yet.
        const actor = validate(family.actor, context.actor);
        context.logger.info(path.join('.'), {
          collection,
          action,
          ...(actor.ok ? callerFields(family, actor.value) : {}),
          outcome: 'refused',
          ...(refusal(error) ?? { code: sent.code }),
        });
      }
      throw sent;
    }
  };
}

/**
 * Starts an app's definition: the family every generated and hand-written
 * use case extends, and the app's client errors. It takes no ports;
 * `build()` does.
 */
export function framework<
  Actor,
  Tenanted extends boolean,
  D extends ErrorMap = Record<never, never>,
>(options: {
  family: Family<Actor, Tenanted>;
  /**
   * The app's client errors, such as app-template's `clientErrors` and
   * `toRpcError`. Every procedure declares them next to Lattice's codes. An
   * app with no domain errors leaves this out.
   */
  errors?: {
    readonly declared: D & DeclaredCheck<D>;
    readonly map: (error: unknown) => unknown;
  };
}): Framework<Actor, D, Record<never, never>, Tenanted> {
  const errors = options.errors ?? { declared: {}, map: (error) => error };
  for (const code of Object.keys(errors.declared)) {
    if (latticeCodes.includes(code)) {
      throw new Error(`Lattice: "${code}" is a Lattice error code`);
    }
  }
  return new Framework<Actor, D, Record<never, never>, Tenanted>(
    options.family,
    errors,
    [],
  );
}
