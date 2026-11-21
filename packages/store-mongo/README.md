# @latticecms/store-mongo

The MongoDB `CollectionStore` for Lattice CMS. Each collection is a Mongo collection of the same name, and a document's `id` is its `_id`. Filters translate one to one into Mongo queries, and the store passes the conformance suite every Lattice store passes.

## Install

```bash
npm install @latticecms/store-mongo @latticecms/core zod
```

`@latticecms/core` and `zod` are peer dependencies. The `mongodb` driver is this package's own dependency: the store owns its client.

## Wiring

```ts
import { MongoStore } from '@latticecms/store-mongo';

const store = new MongoStore({ url: process.env.MONGODB_URL, database: 'crm' });
await store.start();
const crm = createApp({ store, events });
await crm.ensure(); // creates each collection's declared indexes

// On shutdown, after the server stops taking requests:
await store.stop();
```

`new MongoStore({ url, database, client? })` takes a connection string, the database every collection lives in, and `MongoClientOptions` for its client. `serverSelectionTimeoutMS` bounds how long `start()` waits for the server.

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

## Known differences from `MemoryStore`

Both follow MongoDB's null and missing rules, and both pass the same conformance suite. Two differences remain, and the suite does not cover them:

- **String order.** MongoDB compares strings by their UTF-8 bytes, which is code point order. JavaScript compares UTF-16 code units. They agree on everything except U+E000–U+FFFF against characters above U+FFFF, which sort the other way. ASCII and ISO timestamps sort the same.
- **Case folding in `contains`.** MongoDB's case-insensitive regex and JavaScript's `toLowerCase` can disagree outside ASCII, such as for `ß` and the Turkish `İ`.

## Tests

The package's tests run on [mongodb-memory-server](https://github.com/typegoose/mongodb-memory-server): one single-node replica set per run, and a fresh database per test. Nothing needs to be installed. The first run downloads `mongod` (about 100 MB) into `~/.cache/mongodb-binaries`, and later runs reuse it. The server version is pinned in `package.json` (`config.mongodbMemoryServer.version`), and `MONGOMS_VERSION` overrides it. Linux on musl, such as Alpine, has no `mongod` build.
