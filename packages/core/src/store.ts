import { AsyncLocalStorage } from 'node:async_hooks';
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

/** The documents that match `where`, counted by the value of `field`. */
export type CountByQuery = {
  readonly collection: string;
  readonly field: string;
  readonly where?: AnyWhere;
  /** The most groups to return. */
  readonly limit: number;
};

/** A value of the counted field, or null for none, and how many documents hold it. */
export type Group = {
  readonly key: string | number | boolean | null;
  readonly count: number;
};

/**
 * A grouped count (0046). Groups are sorted by count, highest first, then by
 * key, null first. `more` is true when groups past `limit` were left out.
 */
export type Groups = { readonly groups: Group[]; readonly more: boolean };

/**
 * An index on a collection. `fields` maps each field to its direction, in
 * the index's key order. A unique index treats a missing field as null, as
 * MongoDB does, so two documents missing it conflict. An array field keys
 * each of its elements, so two documents that share one element conflict.
 *
 * With `present`, the index covers only documents where each listed field
 * has a value: not missing or null, and for an array, an element that is
 * neither null nor an array. Each is one of `fields`. A document it does not cover is not
 * keyed, so it never conflicts.
 */
export type Index = {
  readonly fields: Readonly<Record<string, 1 | -1>>;
  readonly unique?: boolean;
  readonly present?: readonly string[];
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
  /**
   * How many documents that match `where` hold each value of `field`. An
   * array counts each distinct element once per document; a missing or null
   * value, `[]` and a null element count under `null`.
   */
  abstract countBy(query: CountByQuery): Promise<Groups>;
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
  /**
   * Throws `CONFLICT` when the id exists, with `fields: ['id']`, or when a
   * unique index would break, with that index's fields.
   */
  abstract insert(collection: string, doc: StoredDoc): Promise<void>;
  /**
   * The updated doc, or null when no row matched. Throws `CONFLICT`, with
   * the index's fields, when a unique index would break.
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
   * on the store `work` receives joins the outer one.
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

/** A MemoryStore's data, shared by the store and its transactions' stores. */
type State = {
  readonly collections: Map<string, Map<string, StoredDoc>>;
  readonly indexes: Map<string, Index[]>;
  /** The running transaction, by async context, to find a root call from its work. */
  readonly running: AsyncLocalStorage<Tx>;
  /** Settles when the transaction that holds the store ends. */
  turn: Promise<void>;
};

/** One MemoryStore transaction. */
type Tx = {
  /** Undoes each of its writes, in write order. */
  readonly undo: (() => void)[];
  /** Whether a CONFLICT ended it, as a duplicate key aborts MongoDB's. */
  aborted: boolean;
  /** Whether it has committed or rolled back. */
  done: boolean;
};

/**
 * A call in a transaction after a CONFLICT. MongoDB aborts the transaction
 * on a duplicate key, and the driver then runs `work` again until it times
 * out, so code that catches the CONFLICT and carries on never commits.
 */
function aborted(): Error {
  return new Error(
    'MemoryStore: a CONFLICT aborted this transaction, as a duplicate key aborts a MongoDB transaction. Let the CONFLICT end work, and run the transaction again.',
  );
}

/**
 * A `CollectionStore` in memory, for tests and examples. It stores copies, so
 * a caller that mutates an argument or a returned doc does not change it.
 */
export class MemoryStore extends Adapter(CollectionStore) {
  #state: State = {
    collections: new Map(),
    indexes: new Map(),
    running: new AsyncLocalStorage(),
    turn: Promise.resolve(),
  };
  /**
   * The transaction this store belongs to: the store `work` receives. A call
   * on it joins the transaction, as a call with MongoDB's session does, and
   * a call on the root store does not.
   */
  #tx: Tx | undefined;

  private rows(collection: string): Map<string, StoredDoc> {
    const { collections } = this.#state;
    const existing = collections.get(collection);
    if (existing !== undefined) return existing;
    const rows = new Map<string, StoredDoc>();
    collections.set(collection, rows);
    return rows;
  }

  /**
   * Throws when `doc` has two array fields in one index, and CONFLICT when
   * it would share a unique index's key with another row.
   */
  private checkIndexes(collection: string, doc: StoredDoc): void {
    for (const index of this.#state.indexes.get(collection) ?? []) {
      const keys = keysOf(index, doc);
      if (index.unique !== true) continue;
      for (const row of this.rows(collection).values()) {
        if (row.id !== doc.id && shareKey(keysOf(index, row), keys)) {
          throw this.clash(collection, doc.id, Object.keys(index.fields));
        }
      }
    }
  }

  /** A CONFLICT, which aborts this store's transaction. */
  private clash(collection: string, id: string, fields: string[]) {
    if (this.#tx !== undefined) this.#tx.aborted = true;
    return LatticeError.CONFLICT({ collection, id, fields });
  }

  /** Throws when this store's transaction has ended, or a CONFLICT aborted it. */
  private live(): void {
    if (this.#tx?.done === true) {
      throw new Error('MemoryStore: this transaction has ended');
    }
    if (this.#tx?.aborted === true) throw aborted();
  }

  /** Sets or deletes a row, and logs how to undo it for the transaction. */
  private write(
    collection: string,
    id: string,
    doc: StoredDoc | undefined,
  ): void {
    const rows = this.rows(collection);
    const before = rows.get(id);
    // Stored docs are never mutated in place, so `before` stays the row as
    // it was.
    this.#tx?.undo.push(() => {
      if (before === undefined) rows.delete(id);
      else rows.set(id, before);
    });
    if (doc === undefined) rows.delete(id);
    else rows.set(id, doc);
  }

  async ensure(collection: string, indexes: readonly Index[]): Promise<void> {
    this.live();
    const all = this.#state.indexes;
    const known = all.get(collection) ?? [];
    const added: Index[] = [];
    for (const index of indexes) {
      const fields = Object.keys(index.fields).join(', ');
      const existing = [...known, ...added].find((other) =>
        sameKeys(other, index),
      );
      // Changing an index is a migration, so the same keys with other
      // options reject, as MongoDB's IndexOptionsConflict does.
      if (existing !== undefined) {
        if (!sameOptions(existing, index)) {
          throw new Error(
            `MemoryStore: "${collection}" has an index on ${fields} with other options than the declared one. Changing an index is a migration: drop it in one, since migrations run before ensure().`,
          );
        }
        continue;
      }
      const keys = [...this.rows(collection).values()].map((row) =>
        keysOf(index, row),
      );
      if (index.unique === true && hasDuplicates(keys)) {
        throw new Error(
          `MemoryStore: "${collection}" has duplicates for the unique index on ${fields}`,
        );
      }
      added.push(index);
    }
    all.set(collection, [...known, ...added]);
    // A rollback drops only these. A root `ensure` of one of them while the
    // transaction ran found it and added nothing, so it goes too.
    this.#tx?.undo.push(() => {
      all.set(
        collection,
        (all.get(collection) ?? []).filter((index) => !added.includes(index)),
      );
    });
  }

  /**
   * Runs `work` with a store of its own, and on a throw undoes the writes
   * made through that store. A call on it, `transaction` included, joins.
   * A call on the root store does not: it runs at once, sees writes not yet
   * committed, and is kept on a rollback.
   *
   * Transactions run one at a time. One that starts on the root store from
   * inside another's `work` runs beside it, as a separate one does on
   * MongoDB; waiting would deadlock. One that `work` starts and does not
   * await can outlive it, and run beside the next. A rollback restores the
   * rows it wrote even when a call outside wrote them since, where MongoDB
   * would make that call wait, so a unique index can end up broken.
   *
   * A CONFLICT aborts the transaction, as on MongoDB: a later call in it,
   * or the commit, throws. A `work` that never settles holds the store.
   */
  async transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T> {
    if (this.#tx !== undefined) {
      this.live();
      return work(this);
    }
    const state = this.#state;
    const outer = state.running.getStore();
    let end = () => {};
    if (outer === undefined || outer.done) {
      const before = state.turn;
      state.turn = new Promise((resolve) => {
        end = resolve;
      });
      await before;
    }
    const tx: Tx = { undo: [], aborted: false, done: false };
    const store = new MemoryStore();
    store.#state = state;
    store.#tx = tx;
    try {
      const value = await state.running.run(tx, () => work(store));
      if (tx.aborted) throw aborted();
      return value;
    } catch (error) {
      for (const undo of tx.undo.reverse()) undo();
      throw error;
    } finally {
      // Async context outlives the transaction, in a timer that `work`
      // started, so a root transaction from there must see it has ended.
      tx.done = true;
      end();
    }
  }

  async count(collection: string, where?: AnyWhere): Promise<number> {
    this.live();
    let count = 0;
    for (const doc of this.rows(collection).values()) {
      if (where === undefined || matches(doc, where)) count += 1;
    }
    return count;
  }

  async countBy(query: CountByQuery): Promise<Groups> {
    this.live();
    const { collection, field, where, limit } = query;
    const counts = new Map<Group['key'], number>();
    for (const doc of this.rows(collection).values()) {
      if (where !== undefined && !matches(doc, where)) continue;
      for (const key of groupKeys(doc[field])) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const groups = [...counts]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count || compareKeys(a.key, b.key));
    return { groups: groups.slice(0, limit), more: groups.length > limit };
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
    this.live();
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
    this.live();
    const doc = this.visible(collection, id, where);
    return doc === undefined ? null : structuredClone(doc);
  }

  async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    this.live();
    return ids.flatMap((id) => {
      const doc = this.visible(collection, id, where);
      return doc === undefined ? [] : [structuredClone(doc)];
    });
  }

  async insert(collection: string, doc: StoredDoc): Promise<void> {
    this.live();
    if (this.rows(collection).has(doc.id)) {
      throw this.clash(collection, doc.id, ['id']);
    }
    this.checkIndexes(collection, doc);
    this.write(collection, doc.id, structuredClone(doc));
  }

  async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    this.live();
    const existing = this.visible(collection, id, where);
    if (existing === undefined) return null;
    const fields = Object.entries({ ...existing, ...patch }).filter(
      ([, value]) => value !== undefined,
    );
    const doc: StoredDoc = structuredClone({
      ...Object.fromEntries(fields),
      id,
    });
    this.checkIndexes(collection, doc);
    this.write(collection, id, doc);
    return structuredClone(doc);
  }

  async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    this.live();
    const doc = this.visible(collection, id, where);
    if (doc === undefined) return null;
    this.write(collection, id, undefined);
    return structuredClone(doc);
  }
}

/** How an empty array keys: not as null, and equal to another empty array. */
const emptyArray = Symbol('empty array');

/**
 * An index's keys for `doc`, as MongoDB's: one per element of an array
 * field, a missing field as null. A compound index over an array has a key
 * per element, with the other fields' values. Two array fields in one index
 * throw, empty or not, as MongoDB's "cannot index parallel arrays" does.
 * A document that `present` leaves out has no keys, and is never checked.
 */
function keysOf(index: Index, doc: StoredDoc): unknown[][] {
  if (!(index.present ?? []).every((field) => hasValue(doc[field]))) return [];
  const fields = Object.keys(index.fields);
  const arrays = fields.filter((field) => Array.isArray(doc[field]));
  if (arrays.length > 1) {
    throw new Error(
      `MemoryStore: cannot index parallel arrays ${arrays.map((field) => `[${field}]`).join(' ')}`,
    );
  }
  return fields.reduce<unknown[][]>(
    (keys, field) => {
      const value = doc[field] ?? null;
      const parts = !Array.isArray(value)
        ? [value]
        : value.length === 0
          ? [emptyArray]
          : value;
      return keys.flatMap((key) => parts.map((part) => [...key, part ?? null]));
    },
    [[]],
  );
}

/** Whether two rows' keys, under one index, share a key. */
function hasDuplicates(keys: readonly unknown[][][]): boolean {
  return keys.some((key, i) =>
    keys.slice(i + 1).some((other) => shareKey(key, other)),
  );
}

/** Whether two documents' keys under one index share a key. */
function shareKey(a: readonly unknown[][], b: readonly unknown[][]): boolean {
  return a.some((key) => b.some((other) => isDeepStrictEqual(key, other)));
}

/**
 * Whether a field has a value for `present`. MongoStore's `$type` filter
 * matches an array by its elements and does not look inside a nested one,
 * so `[]`, `[null]` and `[[1]]` have none.
 */
function hasValue(value: unknown): boolean {
  return Array.isArray(value)
    ? value.some((element) => !Array.isArray(element) && isSet(element))
    : isSet(value);
}

function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/** Whether two indexes with the same keys have the same options. */
function sameOptions(a: Index, b: Index): boolean {
  return (
    (a.unique === true) === (b.unique === true) &&
    // MongoDB compares partial filters as documents, whose field order
    // does not matter: two `present` lists with the same fields agree.
    isDeepStrictEqual(new Set(a.present ?? []), new Set(b.present ?? []))
  );
}

/** Whether two indexes have the same keys, in the same order and directions. */
function sameKeys(a: Index, b: Index): boolean {
  return isDeepStrictEqual(Object.entries(a.fields), Object.entries(b.fields));
}

/** The keys a document's value counts under: each distinct one, or null. */
function groupKeys(value: unknown): Set<Group['key']> {
  const values = Array.isArray(value) ? value : [value];
  const keys = new Set<Group['key']>();
  for (const element of values) {
    keys.add(
      typeof element === 'string' ||
        typeof element === 'number' ||
        typeof element === 'boolean'
        ? element
        : null,
    );
  }
  if (keys.size === 0) keys.add(null);
  return keys;
}

/** Keys in MongoDB's order: null first; a field holds one type otherwise. */
function compareKeys(a: Group['key'], b: Group['key']): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
}
