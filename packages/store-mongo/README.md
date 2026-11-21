# @latticecms/store-mongo

The MongoDB `CollectionStore` for Lattice CMS. Each collection is a Mongo collection of the same name, and a document's `id` is its `_id`. Filters translate one to one into Mongo queries, and the store passes the conformance suite every Lattice store passes.

## Install

```bash
npm install @latticecms/store-mongo @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server zod @hexok/logger
```

`@latticecms/core`, `hexok`, `zod` and `@hexok/logger` are peer dependencies, and core's own peers come with it. The `mongodb` driver is this package's own dependency: the store owns its client.

## Wiring

```ts
// examples/crm/src/servers/http/main.ts
const url = process.env.MONGODB_URL;
if (url === undefined) throw new Error('Set MONGODB_URL');
const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'crm',
});
const crm = createApp({
  store,
  events: new LoggingDomainEventPublisher({ logger }),
});

// Start the store, migrate, then create indexes, so a migration can fix
// data before an index that depends on it is built.
await store.start();
await migrate(store, migrations, { logger });
await crm.ensure();

// ... serve ...

// Stop taking requests, let those in flight finish, then close the store.
async function shutdown(signal: string): Promise<void> {
  logger.info('http stopping', { signal });
  await server.close();
  await store.stop();
}
```

`new MongoStore({ url, database, client? })` (`MongoStoreOptions`) takes a connection string, the database every collection lives in, and `MongoClientOptions` for its client. `serverSelectionTimeoutMS` bounds how long `start()` waits for the server.

## Lifecycle

The store owns its `MongoClient`.

- `start()` connects and pings the server. A `start()` while one is pending joins it. A `start()` after `stop()` opens a new client. A failed start closes its client, and a later `start()` begins clean.
- `stop()` closes the client. A pending `start()` rejects with `Stopped`.
- A call before `start()` rejects with `MongoStoreError` `NotStarted`, during it with `Starting`, and after `stop()` with `Stopped`. These are the codes of hexok's Redis adapters, so an app matches every adapter on `error.code`. They mean the call came at the wrong time: fix the call order, and do not retry.

Start the store before the app serves traffic, and stop it after the server closes.

## What it does

- `where` translates operator by operator: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt` and `lte` become their `$` operators. `contains` is a case-insensitive regex with every metacharacter escaped. `exists: true` is `{ $ne: null }` and `exists: false` is `{ $eq: null }`, because in Lattice null does not exist. `and` and `or` become `$and` and `$or`.
- Filters are combined with `$and`, never merged into one object, so a filter on `id` cannot replace the call's own id match.
- `find` sorts by the sort keys and then `_id`, and applies the cursor as one more filter.
- A duplicate key on `insert` or `update`, from the id or a unique index, is Lattice's `CONFLICT` with `{ collection, id }` of the document being written.
- `ensure(collection, indexes)` creates each index with `createIndex` and never drops one. `build().ensure()` calls it for every collection that declares indexes. An index with the same keys and other options rejects, and so does a unique index over existing duplicates: changing an index is a migration.
- `count` is `countDocuments`.
- `has` is equality on the array field, which Mongo matches against any element.
- `transaction(work)` runs `work` in one Mongo transaction on a replica set or a mongos, with a view of the store whose every call carries the session. A standalone server has no transactions, so there `work` runs in order; Lattice's deletes put the parent last. An index is never built inside a transaction.

## Migrations

A data migration changes stored documents once, such as backfilling a new field. Mongo has no schema to migrate; a breaking field change is a data migration. Migrations run forward only: a bad one is fixed by a new one.

```ts
// examples/crm/src/infra/migrations/0001-backfill-deal-archived.ts
import type { Migration } from '@latticecms/store-mongo';

/**
 * Deals written before `archived` existed have no such field, and the read
 * filter `archived: { eq: false }` would hide them. Every organization's
 * deals: a migration is system work, outside access and tenancy. The
 * filter skips the deals already done, so a second run changes nothing.
 */
export default {
  id: 1,
  name: 'backfill-deal-archived',
  async up({ db, logger }) {
    const { modifiedCount } = await db
      .collection('deals')
      .updateMany(
        { archived: { $exists: false } },
        { $set: { archived: false } },
      );
    logger.info('deals backfilled', { modifiedCount });
  },
} satisfies Migration;
```

`up` receives `{ db, session?, signal, logger }`. `db` is the store's raw Mongo database, because a migration reads documents in their old shape, which the collection's types no longer describe. `logger` is a child with the migration's `id` and `name`. The types are `Migration`, `MigrationContext` (what `up` receives), `MigrateOptions` and `Ran`.

The app lists its migrations explicitly, in id order:

```ts
// examples/crm/src/infra/migrations/index.ts
import m0001 from './0001-backfill-deal-archived.js';

/** The app's data migrations, in id order. `migrate()` runs each once. */
export const migrations = [m0001];
```

At startup, start the store, then migrate, then create indexes, as in [Wiring](#wiring), so a migration can fix duplicates before a unique index is built.

`migrate(store, migrations, { logger, lock? })` runs each pending migration once, in order, and returns `{ ran }`: each `{ id, name, durationMs }` that ran. Each one that runs is recorded in `_migrations` with its id, name, `ranAt` and `durationMs`, and logs one line with `id`, `name` and `durationMs`. When nothing is pending, it logs `migrations up to date`.

- **The list is checked first.** Ids run 1, 2, 3 … in list order. A gap, a duplicate, a recorded migration missing from the list, or a recorded one with another name throws a `MigrationError` (`Gap`, `Duplicate`, `Unknown`, `Renamed`) before any migration runs. File names such as `0002-rename-stage.ts` are a convention; the runner reads `id` and `name`.
- **A failure stops the run.** The migration is not recorded, its error passes through after one error log line, and the next run starts again at that migration. So write `up` to be safe to run twice. Filter on what is not done yet, as the CRM's backfill does with `archived: { $exists: false }`.

- **Transactions are opt-in.** With `transaction: true`, `up` gets a `session`, and its writes and its record commit together or not at all. Pass `{ session }` to every write. It needs a replica set, or the run throws `NoTransactions` before anything runs. A long migration can exceed Mongo's transaction limits, which is why it is not the default. The driver may run a transaction's callback again on a transient error, which `up` handles, since it is safe to re-run.
- **One process at a time.** A lease in `_migrations_lock` keeps two processes from migrating together. It is taken on the server's clock, renewed every third of `lock.ttlMs` (60 s by default), and released by a token, so a process never releases another's lease. A lease whose holder died expires and is taken over. A second process logs `migrations waiting for lock`, waits up to `lock.waitMs` (10 minutes by default), and then finds nothing left to run; past `waitMs` it rejects with `LockTimeout`. If the lease is lost while a migration runs, `signal` aborts, and the run stops with `LockLost` without recording that migration. Pass `signal` to long loops.

## Known differences from `MemoryStore`

Both follow MongoDB's null and missing rules, and both pass the same conformance suite. Two differences remain, and the suite does not cover them:

- **String order.** MongoDB compares strings by their UTF-8 bytes, which is code point order. JavaScript compares UTF-16 code units. They agree on everything except U+E000–U+FFFF against characters above U+FFFF, which sort the other way. ASCII and ISO timestamps sort the same.
- **Case folding in `contains`.** MongoDB's case-insensitive regex and JavaScript's `toLowerCase` can disagree outside ASCII, such as for `ß` and the Turkish `İ`.

## Tests

The package's tests run on [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): one single-node replica set and one standalone server per run, started in vitest's `globalSetup`, and a fresh database per test. The standalone server runs the conformance cases that need no transactions. Nothing needs to be installed. The first run downloads `mongod` (about 100 MB) into `~/.cache/mongodb-binaries`, and later runs reuse it. The server version is pinned in `package.json` (`config.mongodbMemoryServer.version`), and `MONGOMS_VERSION` overrides it. Linux on musl, such as Alpine, has no `mongod` build.
