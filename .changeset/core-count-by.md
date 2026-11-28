---
'@latticecms/core': minor
---

Every collection gets a generated `countBy({ field, where?, limit? })`. It returns `{ groups: { key, count }[], more }`: how many matching documents hold each value of a string, number, enum, boolean or array field, in one query. It runs `read` access and the tenant clause, as `count` does. `Repo.countBy` types each key from the field. `CollectionStore` gains `countBy`, so a custom store adapter must implement it; the conformance cases check it. `GroupableField` is exported.

`Repo.find` and `Repo.countBy` throw on a `limit` that is not a positive integer, which stores handled differently.
