import type { z } from 'zod';
import type { AnyCollection } from './collection.js';
import { defaultLimit, defaultSort, type Sort } from './sort.js';
import type { CollectionStore, Doc, FindQuery, Patch } from './store.js';
import type { AnyWhere, Where } from './where.js';

/** A query of `Repo.find`. Each key is optional; the defaults are find's. */
export type RepoQuery<Doc> = {
  readonly where?: Where<Doc>;
  readonly sort?: Sort<Doc>;
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
  get(id: string): Promise<z.output<C['output']> | null>;
  /** The docs that exist, in the order of `ids`. */
  getMany(ids: readonly string[]): Promise<z.output<C['output']>[]>;
  find(query?: RepoQuery<z.output<C['output']>>): Promise<{
    docs: z.output<C['output']>[];
    next: string | null;
  }>;
  /** Stores `data` with a new `id`, `createdAt` and `updatedAt`. */
  insert(data: z.output<C['schema']>): Promise<z.output<C['output']>>;
  /** Writes the fields in `patch` and bumps `updatedAt`; null when no doc has `id`. */
  update(
    id: string,
    patch: Partial<z.output<C['schema']>>,
  ): Promise<z.output<C['output']> | null>;
  /** The removed doc, or null when no doc has `id`. */
  remove(id: string): Promise<z.output<C['output']> | null>;
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
 * The repo of `collection`. The store holds untyped documents (`Doc`); a
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
      const doc: Doc = stamped(data);
      await store.insert(slug, doc);
      return doc;
    },
    update: (id, patch) => store.update(slug, id, touched(patch)),
    remove: (id) => store.remove(slug, id),
  };
}
