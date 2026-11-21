import { Adapter, Port } from 'hexok';
import { LatticeError } from './errors.js';
import { after, compareDocs, encodeCursor, orderOf } from './sort.js';
import { type AnyWhere, matches } from './where.js';

/** A stored document. Every collection's documents have an `id`. */
export type StoredDoc = {
  readonly id: string;
  readonly [field: string]: unknown;
};

/** A shallow change to a document. A key set to undefined removes the field. */
export type Patch = { readonly id?: never; readonly [field: string]: unknown };

export type FindQuery = {
  readonly collection: string;
  readonly where?: AnyWhere;
  /** Keys as `field` or `-field`. Stores add `id` as the last tiebreak. */
  readonly sort: readonly string[];
  readonly limit: number;
  /** The `next` cursor of the previous page. */
  readonly after?: string;
};

/** One page of a find. `next` is null on the last page. */
export type Page = { readonly docs: StoredDoc[]; readonly next: string | null };

/**
 * Storage for every collection. `where` on a single-row call is the access
 * and tenant filter: a row outside it acts as missing.
 */
export abstract class CollectionStore extends Port('CollectionStore') {
  abstract find(query: FindQuery): Promise<Page>;
  abstract get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null>;
  /** The docs that exist and match, in the order of `ids`. */
  abstract getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]>;
  /** Throws `CONFLICT` when the id exists. */
  abstract insert(collection: string, doc: StoredDoc): Promise<void>;
  /** The updated doc, or null when no row matched. */
  abstract update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null>;
  /** The removed doc, or null when no row matched. */
  abstract remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null>;
}

/**
 * A `CollectionStore` in memory, for tests and examples. It stores copies, so
 * a caller that mutates an argument or a returned doc does not change it.
 */
export class MemoryStore extends Adapter(CollectionStore) {
  private readonly collections = new Map<string, Map<string, StoredDoc>>();

  private rows(collection: string): Map<string, StoredDoc> {
    const existing = this.collections.get(collection);
    if (existing !== undefined) return existing;
    const rows = new Map<string, StoredDoc>();
    this.collections.set(collection, rows);
    return rows;
  }

  private visible(
    collection: string,
    id: string,
    where: AnyWhere | undefined,
  ): StoredDoc | undefined {
    const doc = this.rows(collection).get(id);
    if (doc === undefined) return undefined;
    return where === undefined || matches(doc, where) ? doc : undefined;
  }

  async find(query: FindQuery): Promise<Page> {
    const order = orderOf(query.sort);
    const start =
      query.after === undefined ? undefined : after(order, query.after);
    const matching = [...this.rows(query.collection).values()]
      .filter(
        (doc) =>
          (query.where === undefined || matches(doc, query.where)) &&
          (start === undefined || matches(doc, start)),
      )
      .sort(compareDocs(order));
    // One more than the page tells whether another page follows.
    const window = matching.slice(0, query.limit + 1);
    const docs = window.slice(0, query.limit);
    const last = docs.at(-1);
    return {
      docs: docs.map((doc) => structuredClone(doc)),
      next:
        window.length > query.limit && last !== undefined
          ? encodeCursor(order, last)
          : null,
    };
  }

  async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = this.visible(collection, id, where);
    return doc === undefined ? null : structuredClone(doc);
  }

  async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    return ids.flatMap((id) => {
      const doc = this.visible(collection, id, where);
      return doc === undefined ? [] : [structuredClone(doc)];
    });
  }

  async insert(collection: string, doc: StoredDoc): Promise<void> {
    const rows = this.rows(collection);
    if (rows.has(doc.id)) {
      throw LatticeError.CONFLICT({ collection, id: doc.id });
    }
    rows.set(doc.id, structuredClone(doc));
  }

  async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const existing = this.visible(collection, id, where);
    if (existing === undefined) return null;
    const fields = Object.entries({ ...existing, ...patch }).filter(
      ([, value]) => value !== undefined,
    );
    const doc: StoredDoc = structuredClone({
      ...Object.fromEntries(fields),
      id,
    });
    this.rows(collection).set(id, doc);
    return structuredClone(doc);
  }

  async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = this.visible(collection, id, where);
    if (doc === undefined) return null;
    this.rows(collection).delete(id);
    return doc;
  }
}
