---
'@latticecms/store-mongo': minor
---

`@latticecms/store-mongo`: `MongoStore`, the MongoDB `CollectionStore`, and `migrate()`, its data migrations runner.

- `MongoStore` owns its client, with `start()`, `stop()` and `MongoStoreError` for calls at the wrong time. Filters translate one to one, a duplicate key is `CONFLICT`, `ensure` creates indexes and never drops one, `count` uses `countDocuments`, and `has` is equality on the array field. It passes the store conformance suite.
- `transaction(work)` runs `work` in one Mongo transaction on a replica set, with a session-bound view of the store. On a standalone server, `work` runs in order.
- `migrate(store, migrations, { logger, lock? })` runs an explicit list of forward-only data migrations once each, in id order, and records them in `_migrations`. The list is checked against what ran before anything runs. A migration may opt into a transaction. A lease lock in `_migrations_lock` keeps two processes from migrating at once; a second one waits.
- `@latticecms/core` (`^0.1.0`), `hexok`, `zod` and `@hexok/logger` are peer dependencies, and so are core's own peers. Install them in the app: `npm install @latticecms/store-mongo @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server zod @hexok/logger`. `mongodb` is a dependency.
