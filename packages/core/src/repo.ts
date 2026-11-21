import type { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { defaultLimit, defaultSort, type Sort } from './sort.js';
import type { CollectionStore, FindQuery, Patch, StoredDoc } from './store.js';
import type { AnyWhere, Where } from './where.js';

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
 * A typed view of the `CollectionStore` for one collection, for hand-written
 * use cases and event handlers. It trusts typed input, like a hexok
 * repository: no validation, no hooks, no access or tenant scope, and no
 * events. A use case that needs those calls the generated one instead.
 */
export interface Repo<C extends AnyCollection> {
  get(id: string): Promise<Doc<C> | null>;
  /** The docs that exist, in the order of `ids`. */
  getMany(ids: readonly string[]): Promise<Doc<C>[]>;
  find(query?: RepoQuery<Doc<C>>): Promise<{
    docs: Doc<C>[];
    next: string | null;
  }>;
  /** Stores `data` with a new `id`, `createdAt` and `updatedAt`. */
  insert(data: z.output<C['schema']>): Promise<Doc<C>>;
  /** Writes the fields in `patch` and bumps `updatedAt`; null when no doc has `id`. */
  update(
    id: string,
    patch: Partial<z.output<C['schema']>>,
  ): Promise<Doc<C> | null>;
  /** The removed doc, or null when no doc has `id`. */
  remove(id: string): Promise<Doc<C> | null>;
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
  return {
    get: (id) => store.get(slug, id),
    getMany: (ids) => store.getMany(slug, ids),
    find: (query = {}) => store.find(findQuery(slug, query)),
    async insert(data) {
      const doc: StoredDoc = stamped(data);
      await store.insert(slug, doc);
      return doc;
    },
    update: (id, patch) => store.update(slug, id, touched(patch)),
    remove: (id) => store.remove(slug, id),
  };
}
