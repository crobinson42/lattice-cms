---
status: proposed
strength: default
date: 2026-11-27
revisit: A store cannot express a filter on presence, an app needs an index filtered on a value rather than on presence, or one needs a partial index that is not unique.
---

# 0043. A unique index can skip rows without a value

## Decision

- A collection index takes `present: ['emails']`. The index covers only rows where each listed field has a value: not missing or null, and for an array, an element that is neither null nor an array. A row it does not cover is not keyed, so it never clashes.
- `present` needs `unique: true`, lists at least one field, and each is one of the index's fields, once. `collection()` throws otherwise.
- The store's `Index` carries `present` as given. `MongoStore` maps it to `partialFilterExpression: { f: { $type: [every BSON type but null, undefined and array] } }`. `MemoryStore` checks the same rule on `ensure` and on each write. The conformance suite covers both, on a replica set and on a standalone server.
- A declared index with `present` does not stand in for a ref's lookup index: MongoDB uses a partial index only for a query that repeats its filter, and the lookup does not, verified on MongoDB 8.0. When it has exactly the lookup's keys, the lookup index adds `id`, because MongoDB refuses two indexes with the same keys and default name. `id` is the order the lookup reads in.
- Without `present`, nothing changes: a missing field keys as null, as in MongoDB.

## Why

A unique index keys a missing field as null and an empty array as one value. So `{ organizationId, emails }` unique makes two contacts with no emails clash, and so does an optional `externalId` that is unique when set, and a nullified ref. StaffDuty fell back to checks in overrides over a non-unique index, which let duplicates through under concurrency.

A partial filter cannot say `$ne: null`, and `$exists` keeps null. `$type` matches an array by its elements, so one list of types leaves out a missing field, null, `[]` and `[null]` for any field, verified on MongoDB 8.0. The store needs no kind per field from the schema.

## Rejected

- **`partial: Where`.** Most of `Where` cannot map to a partial filter, so it needs a second, smaller vocabulary checked at `ensure()`.
- **A kind per field, compiled from the schema.** The `$type` list covers every kind with one filter.
- **`$exists` alone.** It keeps null, which is the row that clashes.
- **A non-unique partial index.** A query uses it only when it repeats the filter, which a `Where` cannot say on MongoDB.
- **A child collection for array values.** Right when the values are looked up on their own, but heavy for tags and domains.
- **Naming indexes, so the lookup index can share a partial index's keys.** It changes `Index` for one case, and the name would become part of every index's identity in `ensure`.
