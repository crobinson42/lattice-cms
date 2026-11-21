---
status: accepted
strength: lock
date: 2026-11-20
revisit: Only with the maintainer.
---

# 0001. Build on hexok and ts-pf, and never the other way round

## Decision

Lattice is its own repository that depends on `hexok`, `@hexok/*` and `@ts-pf/*`. Generated code is real hexok and ts-pf: `UseCase`, `Port`, `Adapter`, `EventCatalog`, `Errors`, `router`. Lattice adds no parallel adapter model, event bus, logger, error type or HTTP layer. hexok and ts-pf never import Lattice.

## Why

The team already maintains those packages. The v1 handoff defined its own `StorageAdapter`, `AuthZAdapter`, `EventBusAdapter`, `Logger`, `Tracer` and REST layer, which would have meant two of each to maintain. Keeping Lattice a layer above lets hexok and ts-pf stay small and release on their own cadence.

## Rejected

- Putting collections inside hexok or ts-pf: it would tie their releases to admin and field-type churn.
- Defining Lattice's own seams (the v1 handoff).

If Lattice needs something new in hexok or ts-pf, it goes through that repository's own scope gate. Lattice does not work around it.
