---
status: proposed
strength: default
date: 2026-11-27
revisit: A client needs to tell apart two unique indexes over the same fields, or a store cannot say which index clashed.
---

# 0042. CONFLICT names the clashing fields

## Decision

- `CONFLICT` data is `{ collection, id, fields }`. `id` is the document being written. `fields` are the clashing unique index's fields as declared, tenant field included, or `['id']` when the id exists. It is `[]` when the store cannot tell, as on a MongoDB-compatible server whose error has no `keyPattern`.
- The store sets `fields`. `MemoryStore` names the index it checked, and `MongoStore` reads the error's `keyPattern`, with `_id` as `id`.
- It stays a 409. The message is "A document with the same unique key already exists".

## Why

A collection with two unique indexes, such as an email and an external id, returned the same `CONFLICT` for both. An app that tells the user which value is taken had to re-query each index after the error, and that read races the write. The store already knows which index failed.

## Rejected

- **The clashing values, or the other document's id.** A client could read another tenant's value or id through it. Field names say nothing a client does not already know from the schema. Maskable fields are kept out of unique indexes for the same reason.
- **The index's name.** Lattice does not name indexes, and an app declares them by fields.
- **The driver's message.** It quotes the values, and its format is not a contract.
