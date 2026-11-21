---
status: proposed
strength: default
date: 2026-11-20
revisit: A product needs to subscribe to every collection's events without listing them, or hexok publishers stop checking events against one catalog.
---

# 0020. Collection events are classes on the collection, listed in the app's one catalog

## Decision

`collection()` derives three hexok `Event` classes from the schema: `Posts.events.created`, `.updated` and `.deleted`. Lattice generates no `EventCatalog`. The app lists the classes in its own domain catalog, next to its hand-written events. `framework({ events })` takes the app's publisher, and `build()` is a compile error when that publisher cannot take every collection's events.

## Why

A hexok app has one domain catalog, and its publisher port is typed by it. app-template's queue adapter also rejects, at runtime, an event that is not in that catalog. Per-collection catalogs fail both checks, so they would need an adapter and a second catalog system on one queue. Event classes derived from the schema hold no use case references, so the collection stays a pure declaration (0018).

## Rejected

- One generated `EventCatalog` per collection, returned by `build()`: it does not fit the app's publisher without an adapter.
- Both classes on the collection and per-collection catalogs: the same classes registered twice, for no caller that needs it.
