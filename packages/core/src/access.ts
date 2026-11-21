import { Adapter, Port } from 'hexok';
import type { z } from 'zod';
import type { Action, AnyCollection } from './collection.js';
import { LatticeError } from './errors.js';
import type { Doc } from './repo.js';
import type { AnyWhere, FieldWhere, Where } from './where.js';

/** What `Access.check` decides on: who does what to which collection. */
export type AccessRequest<Actor> = {
  readonly actor: Actor;
  readonly collection: string;
  /** A generated operation, or a method's name. */
  readonly action: Action | (string & {});
  /** The parsed input. Passed for `create` only. */
  readonly data?: unknown;
};

/**
 * Decides what a call may see and change (0005). `true` allows every row,
 * `false` refuses the call with FORBIDDEN, and a `Where` limits it to the
 * rows that match. The `Where` names the collection's fields; the port spans
 * every collection, so it is untyped here.
 */
export abstract class Access<Actor = unknown> extends Port('Access') {
  abstract check(request: AccessRequest<Actor>): Promise<boolean | AnyWhere>;
}

/**
 * One access function as the default adapter stores it. A method signature,
 * so its parameter is bivariant: a function typed by the app's actor and a
 * collection's document fits.
 */
type AccessFunction = {
  fn(args: {
    readonly actor: unknown;
    readonly data?: unknown;
  }): boolean | AnyWhere | Promise<boolean | AnyWhere>;
}['fn'];

/** The access functions given at `.collection()`, by action or method name. */
export type AccessMap = Readonly<Record<string, AccessFunction>>;

/** The keys of `access` besides method names. `read` serves find and get. */
type AccessAction = 'read' | 'create' | 'update' | 'delete';

/** What an access function may return for `A`. Create has no row to filter. */
type Allowed<A, D> = A extends 'create' ? boolean : boolean | Where<D>;

/** What an access function receives for `A`. Create also gets its input. */
type AccessArgs<Actor, A, C extends AnyCollection> = A extends 'create'
  ? { readonly actor: Actor; readonly data: z.output<C['schema']> }
  : { readonly actor: Actor };

/**
 * The return types `R` of a collection's access functions, by key. Inferred
 * from the functions, so `AccessCheck` can read the keys of each `Where`:
 * TypeScript does not check excess properties on an object literal that an
 * arrow function returns.
 */
export type AccessReturns<R, C extends AnyCollection> = {
  [A in keyof R]: Allowed<A, Doc<C>>;
};

/** The `access` option of `.collection()`, typed by the app's actor. */
export type AccessFns<Actor, R, C extends AnyCollection> = {
  readonly [A in keyof R]: (
    args: AccessArgs<Actor, A, C>,
  ) => R[A] | Promise<R[A]>;
};

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

type AccessError<R, M, C extends AnyCollection> =
  | {
      [A in keyof R]: A extends AccessAction | keyof M
        ? [Unknown<R[A], Doc<C>>] extends [never]
          ? never
          : `access.${A & string} filters on "${Unknown<R[A], Doc<C>> & string}", which ${C['slug']} does not have`
        : `"${A & string}" is not an action of ${C['slug']}`;
    }[keyof R]
  | {
      [N in Exclude<
        keyof M,
        keyof R
      >]: `${C['slug']}.${N & string} has no access function; it is always FORBIDDEN`;
    }[Exclude<keyof M, keyof R>];

/**
 * Checks `.collection()`'s options: each `Where` names the collection's
 * fields, each key is an action or a method, and each method has a
 * function. On the options object, not on `access`: a check on `access`
 * would depend on the functions it types, and `actor` would lose its type.
 */
export type AccessCheck<R, M, C extends AnyCollection> = [
  AccessError<R, M, C>,
] extends [never]
  ? unknown
  : { readonly '~error': AccessError<R, M, C> };

/**
 * The default adapter: the functions given at `.collection(C, { access })`.
 * `find` and `get` run `read`. A missing function denies.
 */
export class CollectionAccess extends Adapter(Access) {
  constructor(private readonly maps: ReadonlyMap<string, AccessMap>) {
    super();
  }

  override async check(request: AccessRequest<unknown>) {
    const { actor, collection, action, data } = request;
    const map = this.maps.get(collection);
    const name = action === 'find' || action === 'get' ? 'read' : action;
    // Own keys only: an action named `toString` must not reach the prototype.
    const fn =
      map !== undefined && Object.hasOwn(map, name) ? map[name] : undefined;
    if (fn === undefined) return false;
    return fn(action === 'create' ? { actor, data } : { actor });
  }
}

/** A collection's filter for one call: what `Repo` calls run under. */
export class Scope<Slug extends string = string> {
  // A private field makes the type nominal: a plain object with the same
  // fields is not a Scope, so no app can hand a repo a filter it made up.
  readonly #scope = true;

  constructor(
    readonly collection: Slug,
    readonly where: AnyWhere | undefined,
  ) {
    // Read once so noUnusedLocals keeps the brand, as hexok's Port does.
    void this.#scope;
  }
}

/**
 * What trusted code passes to a `Repo` call instead of a `Scope`: event
 * handlers, workers and scripts that act for no caller. It reads and writes
 * every row.
 */
export const unscoped: unique symbol = Symbol('lattice.unscoped');

/**
 * The access of one call, on `ctx.access`. Each answer is kept for the life
 * of the context, so a guard and `execute` check once between them. Create
 * is never kept: its answer depends on `data`.
 */
export class CallAccess {
  /** Answers by collection slug, then action. */
  readonly #answers = new Map<
    string,
    Map<string, Promise<boolean | AnyWhere>>
  >();

  constructor(
    private readonly check: (
      collection: string,
      action: string,
      data: unknown,
    ) => Promise<boolean | AnyWhere>,
  ) {}

  /**
   * The scope of `action` on `collection`. Throws FORBIDDEN when access
   * says no; an unknown action has no function, so it is refused too.
   */
  async scope<C extends AnyCollection>(
    collection: C,
    action: Action | (string & {}),
    data?: unknown,
  ): Promise<Scope<C['slug']>> {
    const { slug } = collection;
    const answer = await this.answer(slug, action, data);
    if (answer === false) throw LatticeError.FORBIDDEN();
    return new Scope(slug, answer === true ? undefined : answer);
  }

  private answer(
    slug: string,
    action: string,
    data: unknown,
  ): Promise<boolean | AnyWhere> {
    if (action === 'create') return this.check(slug, action, data);
    let answers = this.#answers.get(slug);
    if (answers === undefined) {
      answers = new Map();
      this.#answers.set(slug, answers);
    }
    const kept = answers.get(action);
    if (kept !== undefined) return kept;
    const answer = this.check(slug, action, undefined);
    answers.set(action, answer);
    return answer;
  }
}

/** The access of calls made by `actor`, decided by `access`. */
export function callAccess<Actor>(
  access: Access<Actor>,
  actor: Actor,
): CallAccess {
  return new CallAccess((collection, action, data) =>
    access.check({
      actor,
      collection,
      action,
      ...(action === 'create' ? { data } : {}),
    }),
  );
}

/** The filter a `Repo` call runs under. A scope for another collection throws. */
export function whereOf(
  slug: string,
  scope: Scope | typeof unscoped,
): AnyWhere | undefined {
  if (scope === unscoped) return undefined;
  if (scope.collection !== slug) {
    throw new Error(
      `Lattice: the "${slug}" repo was given a scope for "${scope.collection}"`,
    );
  }
  return scope.where;
}
