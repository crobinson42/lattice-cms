import {
  type ContractProcedure,
  type ContractRouterBrand,
  type InferSchemaOutput,
  procedure,
  router,
} from '@ts-pf/contract';
import {
  createImplementer,
  type ImplementedProcedure,
  type ImplementedRouter,
} from '@ts-pf/server';
import type { z } from 'zod';
import {
  type Action,
  type AnyCollection,
  type Operations,
  operations,
} from './collection.js';
import { type EventPublisher, type Executable, generated } from './crud.js';
import type { Family, FamilyContext } from './family.js';
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

/** A collection and the classes attached to it. */
type Entry = {
  readonly collection: AnyCollection;
  readonly methods: Readonly<Record<string, Ctor<unknown> & Schemas>>;
  readonly overrides: Readonly<Record<string, Ctor<unknown>>>;
};

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

/** One collection's contract slice: the generated operations plus its methods. */
type Slice<E extends Entry> = {
  [K in Action | (keyof E['methods'] & string)]: K extends Action
    ? ContractProcedure<
        InferSchemaOutput<Ops<E['collection']>[K]['input']>,
        InferSchemaOutput<Ops<E['collection']>[K]['output']>
      >
    : ContractProcedure<
        InferSchemaOutput<E['methods'][K]['input']>,
        InferSchemaOutput<E['methods'][K]['output']>
      >;
};

/** The generated ts-pf contract: one slice per collection. */
export type Contract<E extends Entries> = {
  [S in keyof E]: Slice<E[S]>;
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

/** What `build()` returns. */
type Built<E extends Entries, Ctx> = {
  readonly contract: Contract<E>;
  readonly app: ImplementedRouter<Contract<E>, Ctx>;
};

type RuntimeContract = Record<
  string,
  Record<string, ContractProcedure<unknown, unknown>>
>;

type RuntimeInstances<Ctx> = Readonly<
  Record<string, Readonly<Record<string, Executable<Ctx>>> | undefined>
>;

export class Framework<Actor, P extends EventPublisher, E extends Entries> {
  constructor(
    private readonly family: Family<Actor>,
    private readonly store: CollectionStore,
    private readonly events: P,
    private readonly entries: readonly Entry[],
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
      E & Record<C['slug'], { collection: C; methods: M; overrides: O }>
    >(this.family, this.store, this.events, [
      ...this.entries,
      { collection, methods, overrides },
    ]);
  }

  /**
   * Builds the contract and the implemented router. The overload states the
   * precise types; the implementation works on the runtime shape, which a
   * loop over collections cannot express as a mapped type.
   */
  build(
    ...args: BuildArgs<E, FamilyContext<Actor>>
  ): Built<E, FamilyContext<Actor>>;
  build(options?: {
    readonly methods?: RuntimeInstances<FamilyContext<Actor>>;
    readonly overrides?: RuntimeInstances<FamilyContext<Actor>>;
  }): {
    readonly contract: RuntimeContract;
    readonly app: ImplementedRouter<RuntimeContract, FamilyContext<Actor>>;
  } {
    const slices: RuntimeContract = {};
    const useCases: Record<
      string,
      Record<string, Executable<FamilyContext<Actor>>>
    > = {};
    for (const { collection, methods, overrides } of this.entries) {
      const { slug } = collection;
      const slice: Record<string, ContractProcedure<unknown, unknown>> = {};
      const sliceUseCases: Record<
        string,
        Executable<FamilyContext<Actor>>
      > = {};
      const ops = operations(collection.schema);
      for (const action of actions) {
        const { input, output } = ops[action];
        slice[action] = procedure.input(input).output(output);
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
        slice[name] = procedure.input(method.input).output(method.output);
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
        ImplementedProcedure<
          ContractProcedure<unknown, unknown>,
          FamilyContext<Actor>
        >
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
    return { contract, app: impl.router(tree) };
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

/** Starts an app: the family every generated and hand-written use case extends. */
export function framework<Actor, P extends EventPublisher>(options: {
  family: Family<Actor>;
  /** Where every collection's documents live. */
  store: CollectionStore;
  /**
   * The app's domain event publisher. Generated writes publish each
   * collection's events through it. An app with no subscribers passes one
   * that does nothing.
   */
  events: P;
}): Framework<Actor, P, Record<never, never>> {
  return new Framework<Actor, P, Record<never, never>>(
    options.family,
    options.store,
    options.events,
    [],
  );
}
