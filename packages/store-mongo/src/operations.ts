import {
  type AnyWhere,
  after,
  encodeCursor,
  type FindQuery,
  type Index,
  orderOf,
  type Page,
  type Patch,
  type StoredDoc,
} from '@latticecms/core/store';
import type { ClientSession, Collection, Db, Document } from 'mongodb';
import { writing } from './errors.js';
import { and, mongoField, toFilter, toSort } from './filter.js';
import type { MongoDoc, MongoDocument } from './mapper.js';

/**
 * The port's operations on one database, optionally inside a session. The
 * store runs them without one, and a transaction's view of the store with
 * its session, so both share every query.
 */
export class MongoOperations {
  readonly #session: { readonly session?: ClientSession };

  constructor(
    private readonly db: Db,
    private readonly docs: MongoDoc,
    session?: ClientSession,
  ) {
    this.#session = session === undefined ? {} : { session };
  }

  #collection(name: string): Collection<MongoDocument> {
    return this.db.collection<MongoDocument>(name);
  }

  #toDoc(doc: MongoDocument): StoredDoc {
    return this.docs.fromModel(doc);
  }

  async ensure(collection: string, indexes: readonly Index[]): Promise<void> {
    const target = this.#collection(collection);
    // createIndex is a no-op for an index that exists, and rejects one with
    // the same keys and other options (IndexOptionsConflict or
    // IndexKeySpecsConflict), or a unique one over duplicates (11000).
    // Each passes through: changing an index is a migration. An index is
    // never built inside a transaction, so it takes no session.
    for (const index of indexes) {
      const keys = Object.fromEntries(
        Object.entries(index.fields).map(([field, direction]) => [
          mongoField(field),
          direction,
        ]),
      );
      await target.createIndex(
        keys,
        index.unique === true ? { unique: true } : {},
      );
    }
  }

  async find(query: FindQuery): Promise<Page> {
    const target = this.#collection(query.collection);
    const order = orderOf(query.sort);
    // The keyset is a Where, so it is filtered like any other.
    const filter = and(
      toFilter(query.where),
      query.after === undefined
        ? undefined
        : toFilter(after(order, query.after)),
    );
    // One more than the page tells whether another page follows.
    const window = await target
      .find(filter, this.#session)
      .sort(toSort(order))
      .limit(query.limit + 1)
      .toArray();
    const docs = window.slice(0, query.limit).map((doc) => this.#toDoc(doc));
    const last = docs.at(-1);
    return {
      docs,
      next:
        window.length > query.limit && last !== undefined
          ? encodeCursor(order, last)
          : null,
    };
  }

  async count(collection: string, where?: AnyWhere): Promise<number> {
    return this.#collection(collection).countDocuments(
      toFilter(where),
      this.#session,
    );
  }

  async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = await this.#collection(collection).findOne(
      byId(id, where),
      this.#session,
    );
    return doc === null ? null : this.#toDoc(doc);
  }

  async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    const found = await this.#collection(collection)
      .find(and({ _id: { $in: [...ids] } }, toFilter(where)), this.#session)
      .toArray();
    const byKey = new Map(found.map((doc) => [doc._id, doc]));
    return ids.flatMap((id) => {
      const doc = byKey.get(id);
      return doc === undefined ? [] : [this.#toDoc(doc)];
    });
  }

  async insert(collection: string, doc: StoredDoc): Promise<void> {
    const target = this.#collection(collection);
    await writing(collection, doc.id, () =>
      target.insertOne(this.docs.toModel(doc), this.#session),
    );
  }

  async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const target = this.#collection(collection);
    const filter = byId(id, where);
    const changes = updateOf(patch);
    if (changes === undefined) {
      const doc = await target.findOne(filter, this.#session);
      return doc === null ? null : this.#toDoc(doc);
    }
    const doc = await writing(collection, id, () =>
      target.findOneAndUpdate(filter, changes, {
        returnDocument: 'after',
        ...this.#session,
      }),
    );
    return doc === null ? null : this.#toDoc(doc);
  }

  async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = await this.#collection(collection).findOneAndDelete(
      byId(id, where),
      this.#session,
    );
    return doc === null ? null : this.#toDoc(doc);
  }
}

/** The document `id`, if it is inside `where`. */
function byId(id: string, where: AnyWhere | undefined): Document {
  return and({ _id: id }, toFilter(where));
}

/**
 * A patch as a Mongo update: `$set` for each value, `$unset` for each key
 * set to undefined. `id` is never written, even when a JavaScript caller
 * passes one. Undefined when the patch changes nothing.
 */
function updateOf(patch: Patch): Document | undefined {
  const set: Record<string, unknown> = {};
  const unset: Record<string, ''> = {};
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'id') continue;
    if (value === undefined) unset[field] = '';
    else set[field] = value;
  }
  const update: Document = {};
  if (Object.keys(set).length > 0) update.$set = set;
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return Object.keys(update).length === 0 ? undefined : update;
}
