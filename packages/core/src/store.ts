import { isDeepStrictEqual } from 'node:util';
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
  /**
   * The sort fields a document may have no value for. Such a document comes
   * after every one with a value, in either direction (0037). `orderOf`
   * takes it, so a store plans a plain sort when nothing here is ascending.
   */
  readonly optional: readonly string[];
  readonly limit: number;
  /** The `next` cursor of the previous page. */
  readonly after?: string;
};

/** One page of a find. `next` is null on the last page. */
export type Page = { readonly docs: StoredDoc[]; readonly next: string | null };

/**
 * An index on a collection. `fields` maps each field to its direction, in
 * the index's key order. A unique index treats a missing field as null, as
 * MongoDB does, so two documents missing it conflict.
 */
export type Index = {
  readonly fields: Readonly<Record<string, 1 | -1>>;
  readonly unique?: boolean;
};

/**
 * Storage for every collection. `where` on a single-row call is the access
 * and tenant filter: a row outside it acts as missing.
 */
export abstract class CollectionStore extends Port('CollectionStore') {
  /**
   * Creates the indexes `collection` lacks, and never drops one. Rejects
   * when a new unique index meets documents that already break it.
   */
  abstract ensure(collection: string, indexes: readonly Index[]): Promise<void>;
  abstract find(query: FindQuery): Promise<Page>;
  /** How many documents match `where`. */
  abstract count(collection: string, where?: AnyWhere): Promise<number>;
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
  /** Throws `CONFLICT` when the id exists, or a unique index would break. */
  abstract insert(collection: string, doc: StoredDoc): Promise<void>;
  /**
   * The updated doc, or null when no row matched. Throws `CONFLICT` when a
   * unique index would break.
   */
  abstract update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null>;
  /**
   * Runs `work` as one unit with a store whose calls join it: a commit, or
   * on a throw, nothing. Each store makes it as atomic as it can. A store
   * without transactions runs `work` on itself, in order. A `transaction`
   * inside `work` joins the outer one.
   */
  abstract transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T>;
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
  private collections = new Map<string, Map<string, StoredDoc>>();
  private indexes = new Map<string, Index[]>();
  /** Whether a transaction is running, so a nested one joins it. */
  private transacting = false;

  private rows(collection: string): Map<string, StoredDoc> {
    const existing = this.collections.get(collection);
    if (existing !== undefined) return existing;
    const rows = new Map<string, StoredDoc>();
    this.collections.set(collection, rows);
    return rows;
  }

  /** The unique indexes of `collection`. */
  private unique(collection: string): Index[] {
    return (this.indexes.get(collection) ?? []).filter(
      (index) => index.unique === true,
    );
  }

  /**
   * Throws CONFLICT when `doc` would share a unique index's key with another
   * row. A missing field keys as null, as in MongoDB.
   */
  private checkUnique(collection: string, doc: StoredDoc): void {
    for (const index of this.unique(collection)) {
      const key = keyOf(index, doc);
      for (const row of this.rows(collection).values()) {
        if (row.id !== doc.id && isDeepStrictEqual(keyOf(index, row), key)) {
          throw LatticeError.CONFLICT({ collection, id: doc.id });
        }
      }
    }
  }

  async ensure(collection: string, indexes: readonly Index[]): Promise<void> {
    const known = this.indexes.get(collection) ?? [];
    const added: Index[] = [];
    for (const index of indexes) {
      const fields = Object.keys(index.fields).join(', ');
      const existing = [...known, ...added].find((other) =>
        sameKeys(other, index),
      );
      // Changing an index is a migration, so the same keys with other
      // options reject, as MongoDB's IndexOptionsConflict does.
      if (existing !== undefined) {
        if ((existing.unique === true) !== (index.unique === true)) {
          throw new Error(
            `MemoryStore: "${collection}" has an index on ${fields} with other options`,
          );
        }
        continue;
      }
      if (index.unique === true && this.hasDuplicates(collection, index)) {
        throw new Error(
          `MemoryStore: "${collection}" has duplicates for the unique index on ${fields}`,
        );
      }
      added.push(index);
    }
    this.indexes.set(collection, [...known, ...added]);
  }

  /** Whether two rows of `collection` share `index`'s key. */
  private hasDuplicates(collection: string, index: Index): boolean {
    const keys = [...this.rows(collection).values()].map((row) =>
      keyOf(index, row),
    );
    return keys.some((key, i) =>
      keys.slice(i + 1).some((other) => isDeepStrictEqual(key, other)),
    );
  }

  /**
   * Snapshots every collection, runs `work`, and restores the snapshot when
   * it throws. It does not isolate: a call made outside `work` while it
   * runs sees its writes, and is lost too when it rolls back.
   */
  async transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T> {
    if (this.transacting) return work(this);
    // Stored docs are never mutated in place, so copying the maps is enough.
    const collections = new Map(
      [...this.collections].map(([name, rows]) => [name, new Map(rows)]),
    );
    const indexes = new Map(
      [...this.indexes].map(([name, list]) => [name, [...list]]),
    );
    this.transacting = true;
    try {
      return await work(this);
    } catch (error) {
      this.collections = collections;
      this.indexes = indexes;
      throw error;
    } finally {
      this.transacting = false;
    }
  }

  async count(collection: string, where?: AnyWhere): Promise<number> {
    let count = 0;
    for (const doc of this.rows(collection).values()) {
      if (where === undefined || matches(doc, where)) count += 1;
    }
    return count;
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
    const order = orderOf(query.sort, query.optional);
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
    this.checkUnique(collection, doc);
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
    this.checkUnique(collection, doc);
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

/** An index's key for `doc`: its fields' values, a missing one as null. */
function keyOf(index: Index, doc: StoredDoc): unknown[] {
  return Object.keys(index.fields).map((field) => doc[field] ?? null);
}

/** Whether two indexes have the same keys, in the same order and directions. */
function sameKeys(a: Index, b: Index): boolean {
  return isDeepStrictEqual(Object.entries(a.fields), Object.entries(b.fields));
}
