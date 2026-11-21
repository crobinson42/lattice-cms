import type { z } from 'zod';
import { type Scope, type unscoped, whereOf } from './access.js';
import type { AnyCollection } from './collection.js';
import { defaultLimit, defaultSort, type Sort } from './sort.js';
import type { CollectionStore, FindQuery, Patch, StoredDoc } from './store.js';
import { type AnyWhere, both, type Where } from './where.js';

/** A collection's stored document: its schema plus `id`, `createdAt` and `updatedAt`. */
export type Doc<C extends { readonly output: z.ZodType }> = z.output<
  C['output']
>;

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
 * A typed view of the `CollectionStore` for one collection, for hand-written
 * use cases and event handlers. It trusts typed input, like a hexok
 * repository: no validation, no hooks and no events. Each call runs under
 * the scope it is given: a row outside it acts as missing.
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
  /** Stores `data` with a new `id`, `createdAt` and `updatedAt`. */
  insert(data: z.output<C['schema']>, scope: RepoScope<C>): Promise<Doc<C>>;
  /** Writes the fields in `patch` and bumps `updatedAt`; null when no doc in scope has `id`. */
  update(
    id: string,
    patch: Partial<z.output<C['schema']>>,
    scope: RepoScope<C>,
  ): Promise<Doc<C> | null>;
  /** The removed doc, or null when no doc in scope has `id`. */
  remove(id: string, scope: RepoScope<C>): Promise<Doc<C> | null>;
}

/** A new document: `data` with an `id`, `createdAt` and `updatedAt`. */
export function stamped<D extends object>(data: D) {
  const now = new Date().toISOString();
  return { ...data, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
}

/** A patch that also bumps `updatedAt`. */
export function touched<P extends Patch>(patch: P) {
  return { ...patch, updatedAt: new Date().toISOString() };
}

/** A store query with find's default sort and limit. */
export function findQuery(
  collection: string,
  query: {
    readonly where?: AnyWhere | undefined;
    readonly sort?: readonly string[] | undefined;
    readonly limit?: number | undefined;
    readonly after?: string | undefined;
  },
): FindQuery {
  const { where, sort, limit, after } = query;
  return {
    collection,
    sort: sort ?? defaultSort,
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
): Repo<AnyCollection> {
  const { slug } = collection;
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
      const where = both(query.where, whereOf(slug, scope));
      return store.find(findQuery(slug, { ...query, where }));
    },
    async insert(data, scope) {
      // A new row has no filter to meet, but a scope for another collection
      // is still refused.
      whereOf(slug, scope);
      const doc: StoredDoc = stamped(data);
      await store.insert(slug, doc);
      return doc;
    },
    async update(id, patch, scope) {
      return store.update(slug, id, touched(patch), whereOf(slug, scope));
    },
    async remove(id, scope) {
      return store.remove(slug, id, whereOf(slug, scope));
    },
  };
}
