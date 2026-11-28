import {
  type AnyWhere,
  after,
  cursorValues,
  encodeCursor,
  type FindQuery,
  type Index,
  type Order,
  orderOf,
  type Page,
  type Patch,
  type StoredDoc,
} from '@latticecms/core/store';
import type { ClientSession, Collection, Db, Document } from 'mongodb';
import { writing } from './errors.js';
import { and, mongoField, toFilter, toSort } from './filter.js';
import type { MongoDoc, MongoDocument } from './mapper.js';
import { traced } from './tracing.js';

/**
 * Every BSON type but null, undefined and array, for `Index.present`. A
 * partial filter cannot say `$ne: null`, and `$exists` keeps null. On an
 * array field, `$type` matches by element, so `[]` and `[null]` are left
 * out, as is an array of arrays.
 */
const valueTypes = [
  'double',
  'string',
  'object',
  'binData',
  'objectId',
  'bool',
  'date',
  'regex',
  'javascript',
  'int',
  'timestamp',
  'long',
  'decimal',
  'minKey',
  'maxKey',
];

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

  /** `work` as one span, named by the Mongo command it runs. */
  #traced<T>(
    operation: string,
    collection: string,
    work: () => Promise<T>,
  ): Promise<T> {
    return traced(this.db.databaseName, operation, collection, work);
  }

  async ensure(collection: string, indexes: readonly Index[]): Promise<void> {
    return this.#traced('createIndexes', collection, async () => {
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
        await target.createIndex(keys, {
          ...(index.unique === true ? { unique: true } : {}),
          ...(index.present === undefined
            ? {}
            : {
                partialFilterExpression: Object.fromEntries(
                  index.present.map((field) => [
                    mongoField(field),
                    { $type: valueTypes },
                  ]),
                ),
              }),
        });
      }
    });
  }

  async find(query: FindQuery): Promise<Page> {
    return this.#traced('find', query.collection, async () => {
      const order = orderOf(query.sort, query.optional);
      // The keyset is a Where, so it is filtered like any other.
      const filter = and(
        toFilter(query.where),
        query.after === undefined
          ? undefined
          : toFilter(after(order, query.after)),
      );
      // One more than the page tells whether another page follows.
      const window = await this.#sorted(
        query.collection,
        filter,
        order,
        query.limit + 1,
        query.after !== undefined &&
          cursorValues(order, query.after)[0] === null,
      );
      const docs = window.slice(0, query.limit).map((doc) => this.#toDoc(doc));
      const last = docs.at(-1);
      return {
        docs,
        next:
          window.length > query.limit && last !== undefined
            ? encodeCursor(order, last)
            : null,
      };
    });
  }

  /**
   * The first `limit` documents matching `filter`, in `order`, with a
   * missing value after every value (0037). Mongo already sorts a missing or
   * null value last on a descending key, so only an ascending key that may
   * be missing needs more than a plain sort:
   *
   * - None: a plain sort, which an index on the sort keys serves.
   * - The first key, and only it: two queries. Rows with a value, in a
   *   plain sort, which an index on the field serves; then, only when that
   *   page is not full, rows without one, ordered by the other keys.
   * - Any other: a computed "has no value" key in an aggregate. Its sort
   *   cannot use an index, so it sorts the matching rows in memory; it is
   *   the one order the other two cannot give.
   */
  async #sorted(
    collection: string,
    filter: Document,
    order: Order,
    limit: number,
    /** Whether the cursor's row had no value for the first key. */
    pastValues: boolean,
  ): Promise<MongoDocument[]> {
    const target = this.#collection(collection);
    const plain = (where: Document, keys: Order) =>
      target
        .find(where, this.#session)
        .sort(toSort(keys))
        .limit(limit)
        .toArray();
    const lagging = order.flatMap((key, index) =>
      key.optional && key.direction === 1
        ? [{ index, field: mongoField(key.field) }]
        : [],
    );
    const [first, ...rest] = order;
    if (lagging.length === 0 || first === undefined) {
      return plain(filter, order);
    }
    if (lagging.length === 1 && lagging[0]?.index === 0) {
      // Past the last row with a value, the first query can find nothing,
      // and would still walk every value in the index on each page.
      const valued = pastValues
        ? []
        : await plain(
            and(filter, toFilter({ [first.field]: { exists: true } })),
            order,
          );
      if (valued.length === limit) return valued;
      const missing = await target
        .find(
          and(filter, toFilter({ [first.field]: { exists: false } })),
          this.#session,
        )
        .sort(toSort(rest))
        .limit(limit - valued.length)
        .toArray();
      return [...valued, ...missing];
    }
    const flag = (index: number) => `__lattice_missing_${index}`;
    return target
      .aggregate<MongoDocument>(
        [
          { $match: filter },
          {
            $addFields: Object.fromEntries(
              lagging.map(({ index, field }) => [
                flag(index),
                {
                  $cond: [
                    { $eq: [{ $ifNull: [`$${field}`, null] }, null] },
                    1,
                    0,
                  ],
                },
              ]),
            ),
          },
          {
            $sort: Object.fromEntries(
              order.flatMap((key, index) => [
                ...(lagging.some((lag) => lag.index === index)
                  ? [[flag(index), 1]]
                  : []),
                [mongoField(key.field), key.direction],
              ]),
            ),
          },
          { $limit: limit },
          {
            $project: Object.fromEntries(
              lagging.map(({ index }) => [flag(index), 0]),
            ),
          },
        ],
        this.#session,
      )
      .toArray();
  }

  async count(collection: string, where?: AnyWhere): Promise<number> {
    return this.#traced('aggregate', collection, async () => {
      return this.#collection(collection).countDocuments(
        toFilter(where),
        this.#session,
      );
    });
  }

  async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#traced('find', collection, async () => {
      const doc = await this.#collection(collection).findOne(
        byId(id, where),
        this.#session,
      );
      return doc === null ? null : this.#toDoc(doc);
    });
  }

  async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    return this.#traced('find', collection, async () => {
      const found = await this.#collection(collection)
        .find(and({ _id: { $in: [...ids] } }, toFilter(where)), this.#session)
        .toArray();
      const byKey = new Map(found.map((doc) => [doc._id, doc]));
      return ids.flatMap((id) => {
        const doc = byKey.get(id);
        return doc === undefined ? [] : [this.#toDoc(doc)];
      });
    });
  }

  async insert(collection: string, doc: StoredDoc): Promise<void> {
    return this.#traced('insert', collection, async () => {
      const target = this.#collection(collection);
      await writing(collection, doc.id, () =>
        target.insertOne(this.docs.toModel(doc), this.#session),
      );
    });
  }

  async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#traced('findAndModify', collection, async () => {
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
    });
  }

  async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#traced('findAndModify', collection, async () => {
      const doc = await this.#collection(collection).findOneAndDelete(
        byId(id, where),
        this.#session,
      );
      return doc === null ? null : this.#toDoc(doc);
    });
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
