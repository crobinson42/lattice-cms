import {
  type AnyWhere,
  CollectionStore,
  type FindQuery,
  type Index,
  type Page,
  type Patch,
  type StoredDoc,
} from '@latticecms/core/store';
import { Adapter } from 'hexok';
import { type Db, MongoClient, type MongoClientOptions } from 'mongodb';
import { MongoStoreError } from './errors.js';
import { MongoDoc } from './mapper.js';
import { MongoOperations } from './operations.js';

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
      readonly ready: Promise<{ db: Db; transactions: boolean }>;
    }
  | {
      readonly kind: 'ready';
      readonly client: MongoClient;
      readonly db: Db;
      /** A replica set or a mongos, which run transactions. */
      readonly transactions: boolean;
    }
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
      const hello = await db.admin().command({ hello: 1 });
      const transactions =
        typeof hello.setName === 'string' || hello.msg === 'isdbgrid';
      return { db, transactions };
    })();
    const starting: State = { kind: 'starting', client, ready };
    this.#state = starting;
    try {
      const { db, transactions } = await ready;
      if (this.#state !== starting) throw MongoStoreError.Stopped();
      this.#state = { kind: 'ready', client, db, transactions };
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

  async #joined(ready: Promise<unknown>): Promise<void> {
    try {
      await ready;
    } catch (error) {
      if (this.#state.kind === 'stopped') throw MongoStoreError.Stopped();
      throw error;
    }
    if (this.#state.kind !== 'ready') throw MongoStoreError.Stopped();
  }

  /** The client and database, or the lifecycle error for a call made now. */
  #connection(): {
    readonly client: MongoClient;
    readonly db: Db;
    readonly transactions: boolean;
  } {
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

  #operations(): MongoOperations {
    return new MongoOperations(this.#connection().db, this.#docs);
  }

  override async ensure(
    collection: string,
    indexes: readonly Index[],
  ): Promise<void> {
    return this.#operations().ensure(collection, indexes);
  }

  override async find(query: FindQuery): Promise<Page> {
    return this.#operations().find(query);
  }

  override async count(collection: string, where?: AnyWhere): Promise<number> {
    return this.#operations().count(collection, where);
  }

  override async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#operations().get(collection, id, where);
  }

  override async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    return this.#operations().getMany(collection, ids, where);
  }

  override async insert(collection: string, doc: StoredDoc): Promise<void> {
    return this.#operations().insert(collection, doc);
  }

  override async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#operations().update(collection, id, patch, where);
  }

  override async remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.#operations().remove(collection, id, where);
  }

  /**
   * Runs `work` in one transaction on a replica set or a mongos, with a view
   * of this store whose every call joins it. A standalone server has no
   * transactions, so there `work` runs on this store, in order.
   */
  override async transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T> {
    const { client, db, transactions } = this.#connection();
    if (!transactions) return work(this);
    return client.withSession((session) =>
      session.withTransaction(() =>
        work(
          new TransactionStore(new MongoOperations(db, this.#docs, session)),
        ),
      ),
    );
  }
}

/**
 * A store inside a transaction: every call carries the session, and a
 * nested `transaction` joins it.
 */
class TransactionStore extends Adapter(CollectionStore) {
  constructor(private readonly operations: MongoOperations) {
    super();
  }

  override ensure(
    collection: string,
    indexes: readonly Index[],
  ): Promise<void> {
    return this.operations.ensure(collection, indexes);
  }

  override find(query: FindQuery): Promise<Page> {
    return this.operations.find(query);
  }

  override count(collection: string, where?: AnyWhere): Promise<number> {
    return this.operations.count(collection, where);
  }

  override get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.operations.get(collection, id, where);
  }

  override getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    return this.operations.getMany(collection, ids, where);
  }

  override insert(collection: string, doc: StoredDoc): Promise<void> {
    return this.operations.insert(collection, doc);
  }

  override update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.operations.update(collection, id, patch, where);
  }

  override remove(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    return this.operations.remove(collection, id, where);
  }

  override transaction<T>(
    work: (store: CollectionStore) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }
}
