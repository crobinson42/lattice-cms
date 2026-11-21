---
'@latticecms/store-mongo': minor
---

`@latticecms/store-mongo`: `MongoStore`, the MongoDB `CollectionStore`. It owns its client, with `start()`, `stop()` and `MongoStoreError` for calls at the wrong time. Filters translate one to one, a duplicate key is `CONFLICT`, `ensure` creates indexes and never drops one, and `count` uses `countDocuments`. It passes the store conformance suite.
