---
'@latticecms/store-mongo': minor
---

First release. `MongoStore`, the MongoDB `CollectionStore` for `@latticecms/core`, and `migrate()`, its data migrations runner.

- `MongoStore` owns its `MongoClient`, with `start()` and `stop()`, and `MongoStoreError` (`NotStarted`, `Starting`, `Stopped`) for a call at the wrong time. It passes the store conformance suite.
- Filters translate one to one into Mongo queries. A duplicate key is Lattice's `CONFLICT`. `ensure` creates indexes and never drops one.
- `transaction(work)` runs `work` in one Mongo transaction on a replica set or mongos. On a standalone server, `work` runs in order, without atomicity.
- `migrate(store, migrations, { logger, lock? })` runs an explicit list of forward-only data migrations once each, in id order, and records them in `_migrations`. The list is checked against what ran before anything runs. A migration may opt into a transaction. A lease in `_migrations_lock` keeps two processes from migrating at once.
- `lattice migrate`, from `@latticecms/cli`, runs `migrate()` as a deploy step from an app's built module.
- Each call is an OpenTelemetry client span, `{operation} {collection}`, a child of the active span, with no document value and no query text.

Install the peers in the app: `npm install @latticecms/store-mongo @latticecms/core hexok@^2 @ts-pf/contract@^1 @ts-pf/protocol@^1 @ts-pf/server@^1 @ts-pf/docs@^1 @ts-pf/mcp@^1 zod@^4 @hexok/logger@^0.2 @opentelemetry/api@^1`. `@latticecms/core` is a peer at `^0.1.0`. The `mongodb` driver is this package's own dependency. See the [README](./README.md#install).

Known limits, listed in [architecture.md](../../docs/architecture.md#known-limits):

- A standalone server runs a transaction's work in order, without atomicity. Run production on a replica set.
- String order outside the BMP, and non-ASCII case folding in `contains`, differ from `MemoryStore`. See the [README](./README.md#known-differences-from-memorystore).
