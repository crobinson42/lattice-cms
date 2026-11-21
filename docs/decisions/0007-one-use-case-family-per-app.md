---
status: accepted
strength: default
date: 2026-11-20
revisit: The Phase 0 type spike shows the family cannot carry both generated and hand-written use cases cleanly.
---

# 0007. Lattice owns one use case family per app

## Decision

`family({ actor, tenantOf })` builds the app's one hexok `UseCase.context` family. Generated CRUD use cases, overrides and custom methods all extend it, so they share one context type and one guard chain (actor, input, access, tenancy).

## Why

An override must be type-compatible with the operation it replaces, and a custom method must get the same access and tenancy guards. One family makes both automatic.

## Rejected

- The app owns the family and passes it in: more wiring for every app.
- Two families with shared guard functions: most flexible, most code.
