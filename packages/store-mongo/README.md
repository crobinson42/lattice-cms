# @latticecms/store-mongo

The MongoDB `CollectionStore` for [`@latticecms/core`](../core). Each collection is a Mongo collection of the same name, and a document's `id` is its `_id`. Filters translate one to one into Mongo queries, and the store passes the conformance suite every Lattice store passes. It also runs the app's data migrations.

Status: before 1.0.

## Install

```bash
npm install @latticecms/store-mongo @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server @ts-pf/docs @ts-pf/mcp zod @hexok/logger @opentelemetry/api
```

`@latticecms/core`, `hexok`, `zod`, `@hexok/logger` and `@opentelemetry/api` are peer dependencies, shared with the app for the reasons [core's README](../core#install) gives. Install core's own peers too, as above. The `mongodb` driver is this package's own dependency: the store owns its client.

The tests run against MongoDB 8.0. Transactions need a replica set or a sharded cluster; see [Transactions](#transactions).

## Wiring

Create the store. The crm reads its settings in one place, for the server, the worker and its scripts:

```ts
// examples/crm/src/infra/store.ts
export function mongoStore(env: NodeJS.ProcessEnv): MongoStore {
  const url = env.MONGODB_URL;
  if (url === undefined) throw new Error('Set MONGODB_URL');
  return new MongoStore({ url, database: env.MONGODB_DATABASE ?? 'crm' });
}
```

Start it, migrate, create the indexes, then serve:

```ts
// examples/crm/src/servers/http/server.ts
const crm = createApp({ store, events: deps.events });
await store.start();
await migrate(store, migrations, { logger });
await crm.ensure();
```

On shutdown, stop the server taking requests, then the store:

```ts
// examples/crm/src/servers/http/server.ts
await server.close();
await store.stop();
```

`new MongoStore({ url, database, client? })` (`MongoStoreOptions`) takes a connection string, the database every collection lives in, and `MongoClientOptions` for its client. `serverSelectionTimeoutMS` bounds how long `start()` waits for the server.

## Lifecycle

The store owns its `MongoClient`.

- `start()` connects and pings the server. A `start()` while one is pending joins it. A `start()` after `stop()` opens a new client. A failed start closes its client, and a later `start()` begins clean.
- `stop()` closes the client. A pending `start()` rejects with `Stopped`.
- A call before `start()` rejects with `MongoStoreError` `NotStarted`, during it with `Starting`, and after `stop()` with `Stopped`. These are the codes of hexok's Redis adapters, so an app matches every adapter on `error.code`. They mean the call came at the wrong time: fix the call order, and do not retry.

Start the store before the app serves traffic, and stop it after the server closes.

## Transactions

Lattice uses `store.transaction(work)` for a delete that cascades or nullifies refs, and for a relation's `set`.

- On a replica set or a mongos, `work` runs in one Mongo transaction, with a view of the store whose every call carries the session. It commits, or on a throw writes nothing. The driver's `withTransaction` may run `work` again on a transient error.
- A standalone server has no transactions, so there `work` runs in order, on the store itself, without atomicity. Lattice's deletes write the parent last, so a failure partway leaves the parent in place, and the children already changed stay changed. Run production on a replica set; a single-node replica set is enough.
- An index is never built inside a transaction.

## Queries

- `where` translates operator by operator: `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt` and `lte` become their `$` operators. `contains` is a case-insensitive regex with every metacharacter escaped. `exists: true` is `{ $ne: null }` and `exists: false` is `{ $eq: null }`, because in Lattice null does not exist. `and` and `or` become `$and` and `$or`.
- Filters are combined with `$and`, never merged into one object, so a filter on `id` cannot replace the call's own id match.
- `find` sorts by the sort keys and then `_id`, and applies the cursor as one more filter. A document with no value for a sort field comes last in either direction. Mongo already sorts a missing or null value last on a descending key, so a sort with no ascending optional key is a plain, index-served sort. When the first key is the one ascending optional key, `find` runs two queries: documents with a value, which an index on the field serves, then, only when that page is not full, documents without one. Any other ascending optional key sorts through an aggregate with a computed key, which cannot use an index for the sort.
- A duplicate key on `insert` or `update`, from the id or a unique index, is Lattice's `CONFLICT` with `{ collection, id, fields }`: `id` is the document being written, and `fields` are the clashing index's keys from the error's `keyPattern`, with `_id` as `id`. A server that leaves `keyPattern` out, as some MongoDB-compatible services do, gives `fields: []`.
- `ensure(collection, indexes)` creates each index with `createIndex` and never drops one. An index with `present` gets a `partialFilterExpression` that matches each listed field by `$type`, every type but null, undefined and array. On an array field, `$type` matches by element, so `[]` and `[null]` are left out. `build().ensure()` calls it for every collection that declares indexes. An index with the same keys and other options rejects, and so does a unique index over existing duplicates: changing an index is a migration.
- `count` is `countDocuments`.
- `has` is equality on the array field, which Mongo matches against any element. `nhas` is `$ne`, which matches when no element is equal, and matches a missing or null array.

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
import m0002 from './0002-backfill-membership-name.js';

/** The app's data migrations, in id order. `migrate()` runs each once. */
export const migrations = [m0001, m0002];
```

At startup, start the store, then migrate, then create indexes, as in [Wiring](#wiring), so a migration can fix duplicates before a unique index is built.

`migrate(store, migrations, { logger, lock? })` runs each pending migration once, in order, and returns `{ ran }`: each `{ id, name, durationMs }` that ran. Each one that runs is recorded in `_migrations` with its id, name, `ranAt` and `durationMs`, and logs one line with `id`, `name` and `durationMs`. When nothing is pending, it logs `migrations up to date`.

- **The list is checked first.** Ids run 1, 2, 3 … in list order. A gap, a duplicate, a recorded migration missing from the list, or a recorded one with another name throws a `MigrationError` (`Gap`, `Duplicate`, `Unknown`, `Renamed`) before any migration runs. File names such as `0002-rename-stage.ts` are a convention; the runner reads `id` and `name`.
- **A failure stops the run.** The migration is not recorded, its error passes through after one error log line, and the next run starts again at that migration. So write `up` to be safe to run twice. Filter on what is not done yet, as the CRM's backfill does with `archived: { $exists: false }`.

- **Transactions are opt-in.** With `transaction: true`, `up` gets a `session`, and its writes and its record commit together or not at all. Pass `{ session }` to every write. It needs a replica set, or the run throws `NoTransactions` before anything runs. A long migration can exceed Mongo's transaction limits, which is why it is not the default. The driver may run a transaction's callback again on a transient error, which `up` handles, since it is safe to re-run.
- **One process at a time.** A lease in `_migrations_lock` keeps two processes from migrating together. It is taken on the server's clock, renewed every third of `lock.ttlMs` (60 s by default), and released by a token, so a process never releases another's lease. A lease whose holder died expires and is taken over. A second process logs `migrations waiting for lock`, waits up to `lock.waitMs` (10 minutes by default), and then finds nothing left to run; past `waitMs` it rejects with `LockTimeout`. If the lease is lost while a migration runs, `signal` aborts, and the run stops with `LockLost` without recording that migration. Pass `signal` to long loops.

### As a deploy step

An app that migrates before it starts, rather than at startup, runs `npx lattice migrate` from [`@latticecms/cli`](../cli#lattice-migrate) after its build. It imports a built module that exports the store, not started, and the list; the crm's is built from:

```ts
// examples/crm/src/servers/scripts/migrate.ts
export const store = mongoStore(process.env);
export { migrations };
```

The command starts the store, runs `migrate()` with a `ConsoleLogger`, stops the store, and exits 1 on a `MigrationError`. Its output is `migrate()`'s log. `lattice migration <name>` writes the next migration and appends it to the list; its `up()` throws until it is written, so an unwritten migration is never recorded as done.

## Tracing

Each store call is one OpenTelemetry client span, a child of the active span, through `@opentelemetry/api`. With no SDK registered it is a no-op. The tracer is `@latticecms/store-mongo`.

- The span is named `{operation} {collection}`, such as `find deals`, after the Mongo command the call runs: `find` (find, get, getMany), `aggregate` (count), `insert`, `findAndModify` (update, remove) and `createIndexes` (ensure).
- Attributes: `db.system.name` (`mongodb`), `db.namespace` (the database), `db.operation.name` and `db.collection.name`.
- A transaction is one `transaction` span, and the calls in it are its children.
- A failed call sets status ERROR and `error.type`: Lattice's code, such as `CONFLICT`, or the error's name. It records no exception event, since a driver's message can quote a document's values, such as a duplicate key.
- There is no `db.query.text`. A Mongo filter has no parameters, so its text would carry the values it matches.

## Errors

| Error | Code | When |
| --- | --- | --- |
| `LatticeError` | `CONFLICT` | A duplicate key on `insert` or `update`, from the id or a unique index. `data` is `{ collection, id, fields }`: the document being written and the clashing index's fields, or `[]` when the error has no `keyPattern`. The driver's message is never parsed or sent |
| `MongoStoreError` | `NotStarted`, `Starting`, `Stopped` | A call before `start()`, during it, or after `stop()`. Fix the call order; do not retry |
| `MigrationError` | `Gap`, `Duplicate`, `Unknown`, `Renamed` | The migration list does not match itself or what ran. Thrown before any migration runs |
| `MigrationError` | `NoTransactions` | A migration asks for a transaction on a deployment without them. Thrown before any migration runs |
| `MigrationError` | `LockTimeout`, `LockLost` | Another process held the lock past `waitMs`, or the lease was lost while a migration ran |

Each is a hexok `Errors` catalog, so `MongoStoreError.is(error)` and `error.code` narrow it. Anything else, such as a network error, passes through from the driver.

## Known differences from `MemoryStore`

Both follow MongoDB's null and missing rules, and both pass the same conformance suite. Two differences remain, and the suite does not cover them:

- **String order.** MongoDB compares strings by their UTF-8 bytes, which is code point order. JavaScript compares UTF-16 code units. They agree on everything except U+E000–U+FFFF against characters above U+FFFF, which sort the other way. ASCII and ISO timestamps sort the same.
- **Case folding in `contains`.** MongoDB's case-insensitive regex and JavaScript's `toLowerCase` can disagree outside ASCII, such as for `ß` and the Turkish `İ`.

## Tests

The package's tests run on [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): one single-node replica set and one standalone server per run, started in vitest's `globalSetup`, and a fresh database per test. The standalone server runs the conformance cases that need no transactions. Nothing needs to be installed. The first run downloads `mongod` (about 100 MB) into `~/.cache/mongodb-binaries`, and later runs reuse it. The server version is pinned in `package.json` (`config.mongodbMemoryServer.version`), and `MONGOMS_VERSION` overrides it. Linux on musl, such as Alpine, has no `mongod` build.
