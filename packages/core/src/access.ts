import { Adapter, Port, validate } from 'hexok';
import type { z } from 'zod';
import type { Action, AnyCollection } from './collection.js';
import { LatticeError } from './errors.js';
import type { CallContext, Family, FamilyContext } from './family.js';
import type { Doc } from './repo.js';
import { Scope, type Tenant, tenancy, tenantClause } from './tenancy.js';
import { type AnyWhere, both, type FieldWhere, type Where } from './where.js';

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

/** The keys of `access` besides method names. `read` serves find, count and get. */
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
 * `find`, `count` and `get` run `read`. A missing function denies.
 */
export class CollectionAccess extends Adapter(Access) {
  constructor(private readonly maps: ReadonlyMap<string, AccessMap>) {
    super();
  }

  override async check(request: AccessRequest<unknown>) {
    const { actor, collection, action, data } = request;
    const map = this.maps.get(collection);
    const name =
      action === 'find' || action === 'get' || action === 'count'
        ? 'read'
        : action;
    // Own keys only: an action named `toString` must not reach the prototype.
    const fn =
      map !== undefined && Object.hasOwn(map, name) ? map[name] : undefined;
    if (fn === undefined) return false;
    return fn(action === 'create' ? { actor, data } : { actor });
  }
}

/**
 * What trusted code passes to a `Repo` call instead of a `Scope`: event
 * handlers, workers and scripts that act for no caller. It reads and writes
 * every row.
 */
export const unscoped: unique symbol = Symbol('lattice.unscoped');

/** What one call's `CallAccess` asks its caller for. */
type Caller = {
  /** The access answer for `action` on `collection`. */
  check(
    collection: string,
    action: string,
    data: unknown,
  ): Promise<boolean | AnyWhere>;
  /** The actor's tenant. Asked after the guards, so the actor is valid. */
  tenant(): Tenant | undefined;
  /** Logs a bypassed scope of a tenanted collection. */
  bypassed(collection: string, action: string): void;
};

/** The generated writes a bypass may not make on a tenanted collection. */
const writes: readonly string[] = ['create', 'update', 'delete'];

/**
 * The access and tenant of one call, on `ctx.access`. Each access answer is
 * kept for the life of the context, so a guard and `execute` check once
 * between them. Create is never kept: its answer depends on `data`.
 */
export class CallAccess {
  /** Answers by collection slug, then action. */
  readonly #answers = new Map<
    string,
    Map<string, Promise<boolean | AnyWhere>>
  >();
  /** The tenant, once asked. */
  #tenant: { readonly value: Tenant | undefined } | undefined;
  /** The bypassed scopes already logged, as `slug action`. */
  readonly #logged = new Set<string>();

  /**
   * @param actor The call's actor as the family's schema parsed it, or a
   * failed parse. The family's first guard reads it: nothing after that
   * guard sees an actor the schema did not produce.
   */
  constructor(
    private readonly caller: Caller,
    private readonly actor:
      | { readonly ok: true; readonly value: unknown }
      | { readonly ok: false },
  ) {}

  /**
   * Whether `access` is a call's access whose actor parsed, and `actor` is
   * that parsed value. A context made any other way, or whose actor was
   * swapped after the parse, is refused.
   */
  static parsed(access: unknown, actor: unknown): boolean {
    return (
      access instanceof CallAccess &&
      access.actor.ok &&
      access.actor.value === actor
    );
  }

  /**
   * The scope of `action` on `collection`: the tenant clause ANDed with the
   * access `Where`. Throws FORBIDDEN when access says no; an unknown action
   * has no function, so it is refused too. A bypass reads across tenants,
   * and a generated write under it is FORBIDDEN.
   */
  async scope<C extends AnyCollection>(
    collection: C,
    action: Action | (string & {}),
    data?: unknown,
  ): Promise<Scope<C['slug']>> {
    const { slug } = collection;
    const tenant = this.#tenantOf(collection);
    // A relation's set writes too: `<relation>.set`. Method names have no dot.
    if (
      tenant === tenancy.bypass &&
      (writes.includes(action) || action.endsWith('.set'))
    ) {
      throw LatticeError.FORBIDDEN();
    }
    const answer = await this.answer(slug, action, data);
    if (answer === false) throw LatticeError.FORBIDDEN();
    if (tenant === tenancy.bypass) this.#logBypass(slug, action);
    return new Scope(
      slug,
      both(
        tenantClause(collection, tenant),
        answer === true ? undefined : answer,
      ),
      typeof tenant === 'string' ? tenant : undefined,
    );
  }

  /**
   * The tenant id a generated create stamps on `collection`, without asking
   * access again: the guard did, with the create's data. Undefined for a
   * global collection.
   */
  static stampOf(
    access: CallAccess,
    collection: AnyCollection,
  ): string | undefined {
    const tenant = access.#tenantOf(collection);
    return typeof tenant === 'string' ? tenant : undefined;
  }

  /** The caller's tenant on `collection`, or undefined when it is global. */
  #tenantOf(collection: AnyCollection): Tenant | undefined {
    if (collection.tenant === undefined) return undefined;
    this.#tenant ??= { value: this.caller.tenant() };
    const { value } = this.#tenant;
    // Fail closed: a null tenant would match rows with no tenant (Mongo's
    // null rule), and an empty one would stamp rows no tenant owns. An app
    // bug, not a client refusal, so a plain Error.
    if (
      value !== tenancy.bypass &&
      (typeof value !== 'string' || value === '')
    ) {
      throw new Error(
        value === undefined
          ? `Lattice: "${collection.slug}" is tenanted, but the family has no tenantOf`
          : `Lattice: tenantOf returned ${JSON.stringify(value) ?? String(value)} for "${collection.slug}"; it must return a non-empty string or tenancy.bypass`,
      );
    }
    return value;
  }

  #logBypass(slug: string, action: string): void {
    const key = `${slug} ${action}`;
    if (this.#logged.has(key)) return;
    this.#logged.add(key);
    this.caller.bypassed(slug, action);
  }

  private answer(
    slug: string,
    action: string,
    data: unknown,
  ): Promise<boolean | AnyWhere> {
    if (action === 'create') return this.caller.check(slug, action, data);
    let answers = this.#answers.get(slug);
    if (answers === undefined) {
      answers = new Map();
      this.#answers.set(slug, answers);
    }
    const kept = answers.get(action);
    if (kept !== undefined) return kept;
    const answer = this.caller.check(slug, action, undefined);
    answers.set(action, answer);
    return answer;
  }
}

/**
 * The context of one call. The actor is parsed once, here, with the
 * family's schema, and everything downstream gets the parsed value: access
 * functions, `tenantOf`, `actorId`, the log lines, `execute` and events. So
 * a key the schema strips, or a value it transforms, never reaches them.
 * An actor that does not parse is kept as given, and the family's first
 * guard refuses the call before anything reads it.
 */
export function familyContext<Actor>(
  access: Access<Actor>,
  base: CallContext<Actor>,
  family: Pick<Family<Actor>, 'actor' | 'actorId' | 'tenantOf'>,
): FamilyContext<Actor> {
  const parsed = validate(family.actor, base.actor);
  const actor = parsed.ok ? parsed.value : base.actor;
  const { logger } = base;
  const caller: Caller = {
    check: (collection, action, data) =>
      access.check({
        actor,
        collection,
        action,
        ...(action === 'create' ? { data } : {}),
      }),
    tenant: () => family.tenantOf?.(actor),
    bypassed: (collection, action) =>
      logger.info('tenancy.bypass', {
        actorId: family.actorId(actor),
        collection,
        action,
        tenancy: 'bypass',
      }),
  };
  return {
    ...base,
    actor,
    access: new CallAccess(
      caller,
      parsed.ok ? { ok: true, value: actor } : { ok: false },
    ),
  };
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
