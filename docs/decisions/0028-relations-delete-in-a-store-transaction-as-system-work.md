---
status: proposed
strength: default
date: 2026-11-21
revisit: A collection lives in a different store from a relation's other side, an app needs per-relation access rules, or a relation outgrows a 1000-link set.
---

# 0028. Relations: derived join collections, and `onDelete` as system work inside the parent's tenant and a store transaction

## Decision

- **`ref(slug, { onDelete? })`** marks a string field, and `z.array(ref(slug))` a list of ids.
  - The marker is a no-op Zod check, so clones such as `.min()` keep it.
  - An unknown slug fails at `build()` and on `.contract`.
  - Writes do not check that the referenced id exists.
- **`many(target, { through, fields?, onDelete? })`** derives the join collection `through`.
  - Its schema is `<parent>Id`, `<target>Id` and `fields`.
  - It inherits the parent's tenant field, and it has its own events.
  - It has no CRUD slice. It gets `<slug>.<relation>.list` and `.set`, which use the parent's `read` and `update` access.
  - `set` replaces the whole set by diffing, with an event per changed link, up to 1000 links.
- **`onDelete` runs in the generated delete only, inside `store.transaction(work)`.** Each store makes it as atomic as it can: MongoStore with `withTransaction` on a replica set, otherwise in order with the parent last. Restrict, cascade and nullify then run:
  - Restrict counts the referencing rows and throws the new declared code `REFERENCED` (409), with `{ collection, id, by: { collection, field } }`.
  - Cascade deletes each child through the generated delete, recursively, and stops at cycles.
  - Nullify unsets or nulls the field, or pulls the id from an array. Nullify on a required ref is a compile error.
  - Array refs cannot cascade.
- **These child steps are system work.** They skip the caller's access functions, but they always carry the parent's tenant clause. A global parent's children are found across tenants.
- **Indexes.** Each ref field, and each join pair, gets an index in `ensure()` automatically, led by the tenant field.
- **`has`.** Arrays gain the `has` Where operator.

## Why

The schema author declares cascades, and the caller was already allowed to delete the parent. A child refusal deep in the tree would be a confusing failure. A restrict that could not see the rows the caller cannot read would orphan them.

Writes do not check existence, so another tenant could store this tenant's id. The tenant clause keeps such a row from blocking a delete, and keeps a cascade from deleting it.

One transaction method on the port gives core one code path. A capability flag would give it two. `REFERENCED` says what CONFLICT ("already exists") cannot.

## Rejected

- **App-declared join collections:** a fourth declaration per relation.
- **A CRUD slice for join collections:** a second way to change links, and one that skips the parent's access.
- **Child steps under the caller's access:** confusing failures, and orphans.
- **`store.supportsTransactions`:** a second code path in core.
- **Reusing CONFLICT for restrict.**
- **An existence check on writes:** a query per write, impossible across stores, and racy all the same.
