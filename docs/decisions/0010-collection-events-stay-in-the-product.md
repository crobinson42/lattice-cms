---
status: accepted
strength: lock
date: 2026-11-20
revisit: Only with the maintainer.
---

# 0010. Collection events stay inside the product

## Decision

Each collection gets a generated hexok `EventCatalog` (`<slug>.created`, `.updated`, `.deleted`), published after a successful write through the app's publisher port. These are domain events. Another product never subscribes to them; the app maps one to a versioned `@hexok/integration-events` message at the edge.

## Why

A domain event changes whenever the collection's schema changes. Publishing it to other products would make every schema change a breaking cross-product change.
