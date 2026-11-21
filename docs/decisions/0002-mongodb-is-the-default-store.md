---
status: accepted
strength: default
date: 2026-11-20
revisit: A product needs relational reporting or a Postgres-only host.
---

# 0002. MongoDB is the default store

## Decision

Collections persist through one `CollectionStore` port. MongoDB is the default adapter (`@latticecms/store-mongo`, Phase 1). `MemoryStore` in `@latticecms/core` serves tests and examples. A Postgres adapter is a later store of the same port.

## Why

MongoDB plus Redis is the team's standard: simple to inspect and debug, and already in production. The port keeps storage replaceable per collection, so one app can mix stores and regions.

## Rejected

- Postgres with Drizzle as the default (the v1 handoff): a second stack to run and learn, for no current product need.
