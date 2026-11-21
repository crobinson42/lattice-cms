import {
  type AnyWhere,
  after,
  CollectionStore,
  encodeCursor,
  type FindQuery,
  type Index,
  orderOf,
  type Page,
  type Patch,
  type StoredDoc,
} from '@latticecms/core/store';
import { Adapter } from 'hexok';
import {
  type Collection,
  type Db,
  type Document,
  MongoClient,
  type MongoClientOptions,
} from 'mongodb';
import { MongoStoreError, writing } from './errors.js';
import { and, mongoField, toFilter, toSort } from './filter.js';
import { MongoDoc, type MongoDocument } from './mapper.js';

export type MongoStoreOptions = {
  /** A `mongodb://` or `mongodb+srv://` connection string. */
  readonly url: string;
  /** The database every collection lives in. */
  readonly database: string;
  /**
   * Options for the store's `MongoClient`. `serverSelectionTimeoutMS`
   * bounds how long `start()` waits for the server.
   */
  readonly client?: MongoClientOptions;
};

/**
 * The started client of each store, for this package's migrations runner.
 * Not exported from the package: a store's public surface is the port,
 * `start` and `stop`.
 */
const connections = new WeakMap<
  MongoStore,
  () => { readonly client: MongoClient; readonly db: Db }
>();

/** The client and database of a started store, or its lifecycle error. */
export function connectionOf(store: MongoStore): {
  readonly client: MongoClient;
  readonly db: Db;
} {
  const connection = connections.get(store);
  if (connection === undefined) throw MongoStoreError.NotStarted();
  return connection();
}

type State =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'starting';
      readonly client: MongoClient;
      readonly ready: Promise<Db>;
    }
  | { readonly kind: 'ready'; readonly client: MongoClient; readonly db: Db }
  | { readonly kind: 'stopped' };

/**
 * The MongoDB `CollectionStore`. It owns its `MongoClient` (0025): `start()`
 * connects and pings, and `stop()` closes the client. A call before
 * `start()`, during it, or after `stop()` rejects with `MongoStoreError`.
 * Each Lattice collection is a Mongo collection of the same name, and a
 * document's `id` is its `_id`.
 */
export class MongoStore extends Adapter(CollectionStore) {
  #state: State = { kind: 'idle' };
  readonly #docs = new MongoDoc();

  constructor(private readonly options: MongoStoreOptions) {
    super();
    connections.set(this, () => this.#connection());
  }

  /**
   * Connects and pings the server. A `start()` while one is pending joins
   * it; one after `stop()` opens a new client. Rejects with `Stopped` when
   * `stop()` is called before it finishes.
   */
  override async start(): Promise<void> {
    const state = this.#state;
    if (state.kind === 'ready') return;
    if (state.kind === 'starting') {
      await this.#joined(state.ready);
      return;
    }
    const client = new MongoClient(this.options.url, this.options.client);
    const ready = (async () => {
      await client.connect();
      const db = client.db(this.options.database);
      await db.command({ ping: 1 });
      return db;
    })();
    const starting: State = { kind: 'starting', client, ready };
    this.#state = starting;
    try {
      const db = await ready;
      if (this.#state !== starting) throw MongoStoreError.Stopped();
      this.#state = { kind: 'ready', client, db };
    } catch (error) {
      // stop() closed the client under the pending connect: the driver's
      // error says only that, so the caller gets Stopped.
      if (this.#state !== starting) throw MongoStoreError.Stopped();
      this.#state = { kind: 'idle' };
      await client.close();
      throw error;
    }
  }

  /** Closes the client. A pending `start()` rejects with `Stopped`. */
  override async stop(): Promise<void> {
    const state = this.#state;
    this.#state = { kind: 'stopped' };
    if (state.kind === 'starting' || state.kind === 'ready') {
      await state.client.close();
    }
  }

  async #joined(ready: Promise<Db>): Promise<void> {
    try {
      await ready;
    } catch (error) {
      if (this.#state.kind === 'stopped') throw MongoStoreError.Stopped();
      throw error;
    }
    if (this.#state.kind !== 'ready') throw MongoStoreError.Stopped();
  }

  /** The client and database, or the lifecycle error for a call made now. */
  #connection(): { readonly client: MongoClient; readonly db: Db } {
    const state = this.#state;
    switch (state.kind) {
      case 'ready':
        return state;
      case 'idle':
        throw MongoStoreError.NotStarted();
      case 'starting':
        throw MongoStoreError.Starting();
      case 'stopped':
        throw MongoStoreError.Stopped();
    }
  }

  /** The Mongo collection, or the lifecycle error for a call made now. */
  #collection(name: string): Collection<MongoDocument> {
    return this.#connection().db.collection<MongoDocument>(name);
  }

  #toDoc(doc: MongoDocument): StoredDoc {
    return this.#docs.fromModel(doc);
  }

  override async ensure(
    collection: string,
    indexes: readonly Index[],
  ): Promise<void> {
    const target = this.#collection(collection);
    // createIndex is a no-op for an index that exists, and rejects one with
    // the same keys and other options (IndexOptionsConflict or
    // IndexKeySpecsConflict), or a unique one over duplicates (11000).
    // Each passes through: changing an index is a migration.
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

  override async find(query: FindQuery): Promise<Page> {
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
      .find(filter)
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

  override async count(collection: string, where?: AnyWhere): Promise<number> {
    return this.#collection(collection).countDocuments(toFilter(where));
  }

  override async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = await this.#collection(collection).findOne(byId(id, where));
    return doc === null ? null : this.#toDoc(doc);
  }

  override async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    const found = await this.#collection(collection)
      .find(and({ _id: { $in: [...ids] } }, toFilter(where)))
      .toArray();
    const byKey = new Map(found.map((doc) => [doc._id, doc]));
    return ids.flatMap((id) => {
      const doc = byKey.get(id);
      return doc === undefined ? [] : [this.#toDoc(doc)];
    });
  }

  override async insert(collection: string, doc: StoredDoc): Promise<void> {
    const target = this.#collection(collection);
    await writing(collection, doc.id, () =>
      target.insertOne(this.#docs.toModel(doc)),
    );
  }

  override async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const target = this.#collection(collection);
    const filter = byId(id, where);
    const changes = updateOf(patch);
    if (changes === undefined) {
      const doc = await target.findOne(filter);
      return doc === null ? null : this.#toDoc(doc);
    }
    const doc = await writing(collection, id, () =>
      target.findOneAndUpdate(filter, changes, { returnDocument: 'after' }),
    );
    return doc === null ? null : this.#toDoc(doc);
  }

  override async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    const doc = await this.#collection(collection).findOneAndDelete(
      byId(id, where),
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
