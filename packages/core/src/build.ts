import type { Logger } from '@hexok/logger';
import {
  type ContractProcedure,
  type ContractRouterBrand,
  type ErrorMap,
  type InferSchemaInput,
  type InferSchemaOutput,
  procedure,
  router,
} from '@ts-pf/contract';
import { isPFError, isUnexpectedError } from '@ts-pf/protocol';
import {
  createImplementer,
  type ImplementedProcedure,
  type ImplementedRouter,
  type MiddlewareFn,
} from '@ts-pf/server';
import { validate } from 'hexok';
import type { z } from 'zod';
import {
  type Access,
  type AccessCheck,
  type AccessFns,
  type AccessMap,
  type AccessReturns,
  CollectionAccess,
  callAccess,
} from './access.js';
import {
  type Action,
  type AnyCollection,
  type Operations,
  operations,
} from './collection.js';
import { type EventPublisher, type Executable, generated } from './crud.js';
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
import { type Repo, repo } from './repo.js';
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

/** A collection, its access functions, and the classes attached to it. */
type Entry = {
  readonly collection: AnyCollection;
  readonly access: AccessMap;
  readonly methods: Readonly<Record<string, Ctor<unknown> & Schemas>>;
  readonly overrides: Readonly<Record<string, Ctor<unknown>>>;
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
  ? Ctor<unknown> &
      Schemas & {
        readonly '~error': `"${N & string}" is a generated operation, an access key or a ts-pf implementer key`;
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

/** What a class that replaces operation `A` of `Col` must be. */
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
  : Ctor<unknown> & {
      readonly '~error': `"${A & string}" is not a generated operation`;
    };

// A rejected slug adds a key the collection lacks, so the error names it.
type SlugCheck<C extends AnyCollection, E extends Entries> = C extends {
  readonly slug: Reserved;
}
  ? { readonly '~error': `"${C['slug']}" is a ts-pf implementer key` }
  : C['slug'] extends keyof E
    ? { readonly '~error': `"${C['slug']}" is already a collection` }
    : unknown;

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

/** One collection's contract slice: the generated operations plus its methods. */
type Slice<E extends Entry, D extends ErrorMap> = {
  [K in Action | (keyof E['methods'] & string)]: K extends Action
    ? Procedure<
        Ops<E['collection']>[K]['input'],
        Ops<E['collection']>[K]['output'],
        D
      >
    : Procedure<E['methods'][K]['input'], E['methods'][K]['output'], D>;
};

/** The generated ts-pf contract: one slice per collection. */
export type Contract<E extends Entries, D extends ErrorMap> = {
  [S in keyof E]: Slice<E[S], D>;
} & ContractRouterBrand;

type Instance<C> = C extends Ctor<infer I> ? I : never;

type Instances<E extends Entries, Kind extends 'methods' | 'overrides', Ctx> = {
  [S in keyof E as [keyof E[S][Kind]] extends [never] ? never : S]: {
    [N in keyof E[S][Kind]]: Instance<E[S][Kind][N]> & Executable<Ctx>;
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
  /** Where every collection's documents live. */
  readonly store: CollectionStore;
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

/** The instance that serves each procedure: generated, override or method. */
type UseCases<E extends Entries, Ctx> = {
  [S in keyof E]: {
    [A in Action]: A extends keyof E[S]['overrides']
      ? Instance<E[S]['overrides'][A]>
      : GeneratedUseCase<E[S]['collection'], A, Ctx>;
  } & { [N in keyof E[S]['methods']]: Instance<E[S]['methods'][N]> };
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

type RuntimeProcedure = ContractProcedure<unknown, unknown, ErrorMap>;

type RuntimeContract = Record<string, Record<string, RuntimeProcedure>>;

/** The app's client errors: its declared map, and the mapper that builds them. */
type AppErrors<D extends ErrorMap> = {
  readonly declared: D;
  /** Returns the error a client receives. ts-pf sends one it returns unchanged as INTERNAL. */
  readonly map: (error: unknown) => unknown;
};

type RuntimeInstances<Ctx> = Readonly<
  Record<string, Readonly<Record<string, Executable<Ctx>>> | undefined>
>;

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
  #contract: Contract<E, D> | undefined;

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
    } & AccessCheck<R, M, C>,
  ): Framework<
    Actor,
    D,
    E & Record<C['slug'], { collection: C; methods: M; overrides: O }>,
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
    const methods: Entry['methods'] = options.methods ?? {};
    for (const name of Object.keys(methods)) {
      if ([...reserved, ...actions, 'read'].some((key) => key === name)) {
        throw new Error(`Lattice: "${slug}.${name}" cannot be a method name`);
      }
    }
    const overrides: Entry['overrides'] = options.overrides ?? {};
    const access: AccessMap = options.access;
    for (const action of Object.keys(overrides)) {
      if (!actions.some((key) => key === action)) {
        throw new Error(
          `Lattice: "${slug}.${action}" is not a generated operation`,
        );
      }
    }
    return new Framework<
      Actor,
      D,
      E & Record<C['slug'], { collection: C; methods: M; overrides: O }>,
      Tenanted
    >(this.family, this.errors, [
      ...this.entries,
      { collection, access, methods, overrides },
    ]);
  }

  /**
   * The ts-pf contract: one slice per collection. Built on first read and
   * the same object after, so clients and codegen import it with no ports.
   */
  get contract(): Contract<E, D> {
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
    readonly methods?: (
      wiring: RuntimeWiring,
    ) => RuntimeInstances<FamilyContext<Actor>>;
    readonly overrides?: (
      wiring: RuntimeWiring,
    ) => RuntimeInstances<FamilyContext<Actor>>;
  }): {
    readonly app: ImplementedRouter<RuntimeContract, CallContext<Actor>>;
    readonly useCases: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    readonly repos: RuntimeWiring['repos'];
    readonly onError: typeof unexpectedErrors;
    readonly ensure: () => Promise<void>;
    readonly context: (base: CallContext<Actor>) => FamilyContext<Actor>;
  } {
    const { store, events } = options;
    const access =
      options.access ??
      new CollectionAccess(
        new Map(
          this.entries.map((entry) => [entry.collection.slug, entry.access]),
        ),
      );
    const context = (base: CallContext<Actor>): FamilyContext<Actor> => ({
      ...base,
      access: callAccess(access, base, this.family),
    });
    const repos = Object.fromEntries(
      this.entries.map(({ collection }) => [
        collection.slug,
        repo(store, collection),
      ]),
    );
    const methodInstances = options.methods?.({ repos });
    const overrideInstances = options.overrides?.({ repos });
    const useCases: Record<
      string,
      Record<string, Executable<FamilyContext<Actor>>>
    > = {};
    for (const { collection, methods, overrides } of this.entries) {
      const { slug } = collection;
      const sliceUseCases: Record<
        string,
        Executable<FamilyContext<Actor>>
      > = {};
      const ops = operations(collection.schema, collection.output);
      for (const action of actions) {
        const declared = overrides[action];
        sliceUseCases[action] =
          declared === undefined
            ? generated(this.family, store, events, collection, ops, action)
            : instanceOf('override', slug, action, declared, overrideInstances);
      }
      for (const [name, method] of Object.entries(methods)) {
        sliceUseCases[name] = instanceOf(
          'method',
          slug,
          name,
          method,
          methodInstances,
        );
      }
      useCases[slug] = sliceUseCases;
    }

    const contract: RuntimeContract = this.contract;
    const impl = createImplementer(contract).$context<CallContext<Actor>>();
    const tree: Record<
      string,
      Record<string, ImplementedProcedure<RuntimeProcedure, CallContext<Actor>>>
    > = {};
    for (const [slug, sliceUseCases] of Object.entries(useCases)) {
      const sliceImpl = impl[slug];
      const sliceTree: (typeof tree)[string] = {};
      for (const [name, useCase] of Object.entries(sliceUseCases)) {
        const builder = sliceImpl?.[name];
        if (builder === undefined) {
          throw new Error(`Lattice: no procedure "${slug}.${name}"`);
        }
        // A fresh context per call: a createLocalClient context object is
        // shared by every call, and access answers are kept on the context.
        sliceTree[name] = builder.handler(({ input, context: base }) =>
          useCase.execute(context(base), input),
        );
      }
      tree[slug] = sliceTree;
    }
    const errors = clientErrors(this.family, this.errors.map);
    return {
      app: impl.use(errors).router(tree),
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

/**
 * The contract of `entries`: Lattice's declared errors and the app's on
 * every procedure. The overload states its type; the implementation builds
 * it in a loop over collections, which a mapped type cannot express.
 */
function contractOf<E extends Entries, D extends ErrorMap>(
  entries: readonly Entry[],
  declared: ErrorMap,
): Contract<E, D>;
function contractOf(
  entries: readonly Entry[],
  declared: ErrorMap,
): RuntimeContract {
  const call = procedure.errors({ ...declaredErrors, ...declared });
  const slices: RuntimeContract = {};
  for (const { collection, methods } of entries) {
    const slice: Record<string, RuntimeProcedure> = {};
    const ops = operations(collection.schema, collection.output);
    for (const action of actions) {
      const { input, output } = ops[action];
      slice[action] = call.input(input).output(output);
    }
    for (const [name, method] of Object.entries(methods)) {
      slice[name] = call.input(method.input).output(method.output);
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
  slug: string,
  name: string,
  declared: Ctor<unknown>,
  instances: RuntimeInstances<Ctx> | undefined,
): Executable<Ctx> {
  const instance = instances?.[slug]?.[name];
  if (instance === undefined) {
    throw new Error(`Lattice: no instance for ${kind} "${slug}.${name}"`);
  }
  if (!(instance instanceof declared)) {
    throw new Error(
      `Lattice: "${slug}.${name}" instance is not an instance of ${declared.name}`,
    );
  }
  return instance;
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
