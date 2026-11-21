import {
  type ContractProcedure,
  type ContractRouterBrand,
  type ErrorMap,
  type InferSchemaInput,
  type InferSchemaOutput,
  procedure,
  router,
} from '@ts-pf/contract';
import { isPFError } from '@ts-pf/protocol';
import {
  createImplementer,
  type ImplementedProcedure,
  type ImplementedRouter,
  type MiddlewareFn,
} from '@ts-pf/server';
import { validate } from 'hexok';
import type { z } from 'zod';
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
import { type Family, type FamilyContext, loggedByFamily } from './family.js';
import { type Repo, repo } from './repo.js';
import type { CollectionStore } from './store.js';

const actions = [
  'find',
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

/** A collection, the classes attached to it, and its repo. */
type Entry = {
  readonly collection: AnyCollection;
  readonly methods: Readonly<Record<string, Ctor<unknown> & Schemas>>;
  readonly overrides: Readonly<Record<string, Ctor<unknown>>>;
};

type Added = Entry & { readonly repo: Repo<AnyCollection> };

type Entries = Record<string, Entry>;

type Ops<Col extends AnyCollection> = Operations<Col['schema']['shape']>;

/**
 * What a class attached as method `N` of `Col` must be: its statics name
 * `Col` and `<slug>.<N>`, and `execute` takes and returns its own schemas'
 * types. `execute` is a property here, not a method, so its input is checked
 * contravariantly: a method signature is bivariant and would accept a
 * narrower input.
 */
type MethodCheck<C, Col extends AnyCollection, N, Ctx> = N extends
  | Action
  | Reserved
  ? Ctor<unknown> &
      Schemas & {
        readonly '~error': `"${N & string}" is a generated operation or a ts-pf implementer key`;
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

// Checked as a tuple, not through `P extends { publish(...) }`: publish is
// usually a method, and a method's parameter is bivariant, so a publisher of
// another catalog's events would pass.
type EventCheck<Col extends AnyCollection, P extends EventPublisher> = [
  Refused<Col, P>,
] extends [never]
  ? unknown
  : {
      readonly '~error': `the events publisher does not take "${Refused<Col, P> & string}"`;
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

/** What `build()` takes: one instance per attached class, by slug and name. */
type BuildOptions<E extends Entries, Ctx> = ([
  keyof Instances<E, 'methods', Ctx>,
] extends [never]
  ? { readonly methods?: Record<never, never> }
  : { readonly methods: Instances<E, 'methods', Ctx> }) &
  ([keyof Instances<E, 'overrides', Ctx>] extends [never]
    ? { readonly overrides?: Record<never, never> }
    : { readonly overrides: Instances<E, 'overrides', Ctx> });

type BuildArgs<E extends Entries, Ctx> = [
  keyof Instances<E, 'methods', Ctx> | keyof Instances<E, 'overrides', Ctx>,
] extends [never]
  ? [options?: BuildOptions<E, Ctx>]
  : [options: BuildOptions<E, Ctx>];

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
type Built<E extends Entries, D extends ErrorMap, Ctx> = {
  readonly contract: Contract<E, D>;
  readonly app: ImplementedRouter<Contract<E, D>, Ctx>;
  readonly useCases: UseCases<E, Ctx>;
  readonly repos: { [S in keyof E]: Repo<E[S]['collection']> };
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

export class Framework<
  Actor,
  P extends EventPublisher,
  D extends ErrorMap,
  E extends Entries,
> {
  constructor(
    private readonly family: Family<Actor>,
    private readonly store: CollectionStore,
    private readonly events: P,
    private readonly errors: AppErrors<ErrorMap>,
    private readonly entries: readonly Added[],
  ) {}

  /**
   * Adds a collection, and the methods and overrides attached to it. Its slug
   * becomes its contract slice.
   */
  collection<
    C extends AnyCollection,
    M extends {
      [N in keyof M]: MethodCheck<M[N], C, N, FamilyContext<Actor>>;
    } = Record<never, never>,
    O extends {
      [A in keyof O]: OverrideCheck<C, A, FamilyContext<Actor>>;
    } = Record<never, never>,
  >(
    collection: C & SlugCheck<C, E> & EventCheck<C, P>,
    options?: { readonly methods?: M; readonly overrides?: O },
  ): Framework<
    Actor,
    P,
    D,
    E & Record<C['slug'], { collection: C; methods: M; overrides: O }>
  > {
    const { slug } = collection;
    if (reserved.some((key) => key === slug)) {
      throw new Error(`Lattice: "${slug}" is a ts-pf implementer key`);
    }
    if (this.entries.some((entry) => entry.collection.slug === slug)) {
      throw new Error(`Lattice: "${slug}" is already a collection`);
    }
    const methods: Entry['methods'] = options?.methods ?? {};
    for (const name of Object.keys(methods)) {
      if ([...reserved, ...actions].some((key) => key === name)) {
        throw new Error(`Lattice: "${slug}.${name}" cannot be a method name`);
      }
    }
    const overrides: Entry['overrides'] = options?.overrides ?? {};
    for (const action of Object.keys(overrides)) {
      if (!actions.some((key) => key === action)) {
        throw new Error(
          `Lattice: "${slug}.${action}" is not a generated operation`,
        );
      }
    }
    return new Framework<
      Actor,
      P,
      D,
      E & Record<C['slug'], { collection: C; methods: M; overrides: O }>
    >(this.family, this.store, this.events, this.errors, [
      ...this.entries,
      { collection, methods, overrides, repo: repo(this.store, collection) },
    ]);
  }

  /**
   * The repo of a collection this app added, for the method and override
   * instances `build()` takes. `build()` returns the same object in `repos`.
   * The overload types it by the collection; the implementation finds it by
   * slug, which a mapped type cannot express.
   */
  repo<C extends E[keyof E]['collection']>(collection: C): Repo<C>;
  repo(collection: AnyCollection): Repo<AnyCollection> {
    const { slug } = collection;
    const entry = this.entries.find((added) => added.collection.slug === slug);
    if (entry === undefined) {
      throw new Error(`Lattice: "${slug}" is not a collection of this app`);
    }
    return entry.repo;
  }

  /**
   * Builds the contract and the implemented router. The overload states the
   * precise types; the implementation works on the runtime shape, which a
   * loop over collections cannot express as a mapped type.
   */
  build(
    ...args: BuildArgs<E, FamilyContext<Actor>>
  ): Built<E, D, FamilyContext<Actor>>;
  build(options?: {
    readonly methods?: RuntimeInstances<FamilyContext<Actor>>;
    readonly overrides?: RuntimeInstances<FamilyContext<Actor>>;
  }): {
    readonly contract: RuntimeContract;
    readonly app: ImplementedRouter<RuntimeContract, FamilyContext<Actor>>;
    readonly useCases: Readonly<
      Record<string, Readonly<Record<string, unknown>>>
    >;
    readonly repos: Readonly<Record<string, Repo<AnyCollection>>>;
  } {
    const call = procedure.errors({
      ...declaredErrors,
      ...this.errors.declared,
    });
    const slices: RuntimeContract = {};
    const useCases: Record<
      string,
      Record<string, Executable<FamilyContext<Actor>>>
    > = {};
    for (const { collection, methods, overrides } of this.entries) {
      const { slug } = collection;
      const slice: Record<string, RuntimeProcedure> = {};
      const sliceUseCases: Record<
        string,
        Executable<FamilyContext<Actor>>
      > = {};
      const ops = operations(collection.schema);
      for (const action of actions) {
        const { input, output } = ops[action];
        slice[action] = call.input(input).output(output);
        const declared = overrides[action];
        sliceUseCases[action] =
          declared === undefined
            ? generated(
                this.family,
                this.store,
                this.events,
                collection,
                ops,
                action,
              )
            : instanceOf(
                'override',
                slug,
                action,
                declared,
                options?.overrides,
              );
      }
      for (const [name, method] of Object.entries(methods)) {
        slice[name] = call.input(method.input).output(method.output);
        sliceUseCases[name] = instanceOf(
          'method',
          slug,
          name,
          method,
          options?.methods,
        );
      }
      slices[slug] = slice;
      useCases[slug] = sliceUseCases;
    }

    const contract = router(slices);
    const impl = createImplementer(contract).$context<FamilyContext<Actor>>();
    const tree: Record<
      string,
      Record<
        string,
        ImplementedProcedure<RuntimeProcedure, FamilyContext<Actor>>
      >
    > = {};
    for (const [slug, sliceUseCases] of Object.entries(useCases)) {
      const sliceImpl = impl[slug];
      const sliceTree: (typeof tree)[string] = {};
      for (const [name, useCase] of Object.entries(sliceUseCases)) {
        const builder = sliceImpl?.[name];
        if (builder === undefined) {
          throw new Error(`Lattice: no procedure "${slug}.${name}"`);
        }
        sliceTree[name] = builder.handler(({ input, context }) =>
          useCase.execute(context, input),
        );
      }
      tree[slug] = sliceTree;
    }
    const errors = clientErrors(this.family, this.errors.map);
    return {
      contract,
      app: impl.use(errors).router(tree),
      useCases,
      repos: Object.fromEntries(
        this.entries.map((entry) => [entry.collection.slug, entry.repo]),
      ),
    };
  }
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
): MiddlewareFn<FamilyContext<Actor>> {
  return async ({ context, next, path }) => {
    try {
      return await next();
    } catch (error) {
      const sent = toClientError(error, map);
      if (
        isPFError(sent) &&
        sent.code !== 'INTERNAL' &&
        !loggedByFamily(error)
      ) {
        const [collection, action] = path;
        // The guards may not have checked the actor yet.
        const actor = validate(family.actor, context.actor);
        context.logger.info(path.join('.'), {
          collection,
          action,
          ...(actor.ok ? { actorId: family.actorId(actor.value) } : {}),
          outcome: 'refused',
          ...(refusal(error) ?? { code: sent.code }),
        });
      }
      throw sent;
    }
  };
}

/** Starts an app: the family every generated and hand-written use case extends. */
export function framework<
  Actor,
  P extends EventPublisher,
  D extends ErrorMap = Record<never, never>,
>(options: {
  family: Family<Actor>;
  /** Where every collection's documents live. */
  store: CollectionStore;
  /**
   * The app's domain event publisher. Generated writes publish each
   * collection's events through it. An app with no subscribers passes one
   * that does nothing.
   */
  events: P;
  /**
   * The app's client errors, such as app-template's `clientErrors` and
   * `toRpcError`. Every procedure declares them next to Lattice's codes. An
   * app with no domain errors leaves this out.
   */
  errors?: {
    readonly declared: D & DeclaredCheck<D>;
    readonly map: (error: unknown) => unknown;
  };
}): Framework<Actor, P, D, Record<never, never>> {
  const errors = options.errors ?? { declared: {}, map: (error) => error };
  for (const code of Object.keys(errors.declared)) {
    if (latticeCodes.includes(code)) {
      throw new Error(`Lattice: "${code}" is a Lattice error code`);
    }
  }
  return new Framework<Actor, P, D, Record<never, never>>(
    options.family,
    options.store,
    options.events,
    errors,
    [],
  );
}
