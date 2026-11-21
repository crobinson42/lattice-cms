---
status: accepted
strength: lock
date: 2026-11-20
revisit: Only with the maintainer.
---

# 0004. Relations are ID references and join collections, never database joins

## Decision

`ref()` stores an ID on the child. `many()` uses an explicit join collection, which is a real collection with its own use cases, access and events. Population collects IDs per target collection and calls `getMany` once each. No store adapter performs a join.

## Why

Collections may live in different stores, clusters or regions. ID references keep every relation working across them. Explicit join collections can carry metadata (`sortOrder`, `isPrimary`) and are inspectable and auditable.

## Rejected

- Hidden junction tables or `$lookup`: tie related collections to one database.
- ID arrays as the main model: no metadata, no per-link access, unbounded document growth.
