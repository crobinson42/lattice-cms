import type { z } from 'zod';
import { unscoped, whereOf } from './access.js';
import type { AnyCollection } from './collection.js';
import { LatticeError, parse } from './errors.js';
import { defaultLimit, defaultSort, keyOf, type Sort } from './sort.js';
import type { CollectionStore, FindQuery, Patch, StoredDoc } from './store.js';
import { type Scope, type TenantField, withoutTenant } from './tenancy.js';
import {
  type AnyWhere,
  both,
  checkCodeWhere,
  nullish,
  type Where,
} from './where.js';

/** A collection's stored document: its schema plus `id`, `createdAt` and `updatedAt`. */
export type Doc<C extends { readonly output: z.ZodType }> = z.output<
  C['output']
>;

/**
 * A collection's document as a client receives it: `Doc`, with each
 * maskable field optional, since the caller's rules may withhold it.
 */
export type ClientDoc<C extends { readonly clientOutput: z.ZodType }> =
  z.output<C['clientOutput']>;

/** A query of `Repo.find`. Each key is optional; the defaults are find's. */
export type RepoQuery<D> = {
  readonly where?: Where<D>;
  readonly sort?: Sort<D>;
  readonly limit?: number;
  /** The `next` cursor of the previous page. */
  readonly after?: string;
};

/**
 * What a `Repo` call runs under: the call's scope for this collection, from
 * `ctx.access.scope()`, or `unscoped` for trusted code that acts for no
 * caller. Required, so a forgotten filter cannot read every row (0023).
 */
export type RepoScope<C extends AnyCollection> =
  | Scope<C['slug']>
  | typeof unscoped;

/**
 * What `insert` runs under. A tenanted collection's new row needs its
 * tenant, so `unscoped` cannot insert into it: use the call's scope, or
 * `tenancy.scope(C, tenantId)`.
 */
export type InsertScope<C extends AnyCollection> = [TenantField<C>] extends [
  never,
]
  ? RepoScope<C>
  : Scope<C['slug']>;

/**
 * A typed view of the `CollectionStore` for one collection, for hand-written
 * use cases and event handlers. It is trusted: no hooks, no events and no
 * access. `insert` parses its data with the schema, as create does; `update`
 * writes its typed patch as given. Each call runs under
 * the scope it is given: a row outside it acts as missing. A tenant bypass
 * scope reads only: a write through it on a tenanted collection is
 * FORBIDDEN.
 */
export interface Repo<C extends AnyCollection> {
  get(id: string, scope: RepoScope<C>): Promise<Doc<C> | null>;
  /** The docs that exist and are in scope, in the order of `ids`. */
  getMany(ids: readonly string[], scope: RepoScope<C>): Promise<Doc<C>[]>;
  find(
    query: RepoQuery<Doc<C>>,
    scope: RepoScope<C>,
  ): Promise<{
    docs: Doc<C>[];
    next: string | null;
  }>;
  /** How many documents in scope match `where`. */
  count(where: Where<Doc<C>>, scope: RepoScope<C>): Promise<number>;
  /**
   * Parses `data` with the collection's schema, as create does: defaults
   * apply, unknown keys are dropped, and a failed check is VALIDATION. Then
   * stores it with `createdAt`, `updatedAt`, the scope's tenant, and a new
   * `id`, or `options.id`. An id that exists is CONFLICT.
   */
  insert(
    data: z.input<C['schema']>,
    scope: InsertScope<C>,
    options?: InsertOptions,
  ): Promise<Doc<C>>;
  /**
   * Writes the fields in `patch` and bumps `updatedAt`; null when no doc in
   * scope has `id`, or it fails `options.if`. It never writes the tenant
   * field.
   */
  update(
    id: string,
    patch: Partial<z.output<C['schema']>>,
    scope: RepoScope<C>,
    options?: WriteOptions<Doc<C>>,
  ): Promise<Doc<C> | null>;
  /**
   * The removed doc, or null when no doc in scope has `id`, or it fails
   * `options.if`.
   */
  remove(
    id: string,
    scope: RepoScope<C>,
    options?: WriteOptions<Doc<C>>,
  ): Promise<Doc<C> | null>;
}

/** Options of `Repo.insert`. */
export type InsertOptions = {
  /**
   * The new document's id, in place of a new UUID: for a row that shares
   * another's id, such as a projection of it.
   */
  readonly id?: string;
};

/** Options of `Repo.update` and `Repo.remove`. */
export type WriteOptions<D> = {
  /**
   * A condition the row must meet, checked in the same store call as the
   * write: a version, a state, a count. A row that fails it is left alone,
   * and the call returns null.
   */
  readonly if?: Where<D>;
};

/**
 * Runs `work` as one unit of store writes: a commit, or on a throw, nothing.
 * `work` receives repos bound to the transaction, and calls made through
 * them join it. Repos publish no events, so publish after it resolves. The
 * store makes it as atomic as it can (`CollectionStore.transaction`).
 *
 * A use case names the repos it needs: `Transaction<{ deals: Repo<typeof
 * Deals> }>`. The one `build()` gives, over every repo, fits it.
 */
export type Transaction<R> = <T>(work: (repos: R) => Promise<T>) => Promise<T>;

/**
 * The filter of a write. A bypass scope has no tenant, so it cannot write a
 * tenanted collection.
 */
function writable(
  collection: AnyCollection,
  scope: Scope | typeof unscoped,
): AnyWhere | undefined {
  const where = whereOf(collection.slug, scope);
  if (
    collection.tenant !== undefined &&
    scope !== unscoped &&
    scope.tenantId === undefined
  ) {
    throw LatticeError.FORBIDDEN();
  }
  return where;
}

/**
 * A new document: `data` with an `id`, `createdAt` and `updatedAt`. The id
 * is a new UUID unless server code gave one.
 */
export function stamped<D extends object>(
  data: D,
  id: string = crypto.randomUUID(),
) {
  const now = new Date().toISOString();
  return { ...data, id, createdAt: now, updatedAt: now };
}

/** A given id, which must be a non-empty string, as a UUID is. */
function idOf(slug: string, id: string): string {
  if (typeof id !== 'string' || id === '') {
    throw new Error(
      `Lattice: an insert into "${slug}" was given the id ${JSON.stringify(id) ?? String(id)}; it must be a non-empty string`,
    );
  }
  return id;
}

/** A patch that also bumps `updatedAt`. */
export function touched<P extends Patch>(patch: P) {
  return { ...patch, updatedAt: new Date().toISOString() };
}

/** A store query with find's default sort and limit. */
export function findQuery(
  collection: AnyCollection,
  query: {
    readonly where?: AnyWhere | undefined;
    readonly sort?: readonly string[] | undefined;
    readonly limit?: number | undefined;
    readonly after?: string | undefined;
  },
): FindQuery {
  const { where, limit, after } = query;
  const sort = query.sort ?? defaultSort;
  const { shape } = collection.output;
  return {
    collection: collection.slug,
    sort,
    // The sort fields the schema lets a document lack.
    optional: sort
      .map((key) => keyOf(key).field)
      .filter((field) => {
        const schema = shape[field];
        return schema !== undefined && nullish(schema);
      }),
    limit: limit ?? defaultLimit,
    ...(where === undefined ? {} : { where }),
    ...(after === undefined ? {} : { after }),
  };
}

/**
 * The repo of `collection`. The store holds untyped documents (`StoredDoc`); a
 * repo trusts that each one has its collection's type, as the writes that
 * put it there did. The overload states that type; the implementation is
 * typed for any collection, so no value is cast.
 */
export function repo<C extends AnyCollection>(
  store: CollectionStore,
  collection: C,
): Repo<C>;
export function repo(
  store: CollectionStore,
  collection: AnyCollection,
): Omit<Repo<AnyCollection>, 'insert'> & {
  // Any collection: a global one's insert takes `unscoped` too.
  insert(
    data: z.input<AnyCollection['schema']>,
    scope: RepoScope<AnyCollection>,
    options?: InsertOptions,
  ): Promise<Doc<AnyCollection>>;
} {
  const { slug } = collection;
  // A Where that code built is checked as an access answer is: an undefined
  // operand would drop its clause, so a guard would pass, or a find widen.
  const checked = (where: AnyWhere | undefined, source: string) => {
    if (where !== undefined) {
      checkCodeWhere(collection.output, where, `${source} on "${slug}"`);
    }
    return where;
  };
  // Each method is async, so a scope for another collection rejects, as a
  // store failure would, rather than throwing before a promise exists.
  return {
    async get(id, scope) {
      return store.get(slug, id, whereOf(slug, scope));
    },
    async getMany(ids, scope) {
      return store.getMany(slug, ids, whereOf(slug, scope));
    },
    async find(query, scope) {
      const where = both(
        checked(query.where, 'a repo find'),
        whereOf(slug, scope),
      );
      return store.find(findQuery(collection, { ...query, where }));
    },
    async count(where, scope) {
      return store.count(
        slug,
        both(checked(where, 'a repo count'), whereOf(slug, scope)),
      );
    },
    async insert(data, scope, options) {
      // A new row has no filter to meet, but a scope for another collection
      // is still refused.
      writable(collection, scope);
      const { tenant } = collection;
      if (tenant !== undefined && scope === unscoped) {
        throw new Error(
          `Lattice: "${slug}" is tenanted, so insert needs a scope with a tenant, such as tenancy.scope()`,
        );
      }
      // The tenant comes from the scope, after the parse: the schema has none.
      const parsed = parse(collection.schema, data);
      const doc: StoredDoc = stamped(
        tenant === undefined || scope === unscoped
          ? parsed
          : { ...parsed, [tenant]: scope.tenantId },
        options?.id === undefined ? undefined : idOf(slug, options.id),
      );
      await store.insert(slug, doc);
      return doc;
    },
    async update(id, patch, scope, options) {
      const where = both(
        writable(collection, scope),
        checked(options?.if, 'a repo update’s if'),
      );
      const changes = touched(withoutTenant(collection, patch));
      return store.update(slug, id, changes, where);
    },
    async remove(id, scope, options) {
      const where = both(
        writable(collection, scope),
        checked(options?.if, 'a repo remove’s if'),
      );
      return store.remove(slug, id, where);
    },
  };
}
