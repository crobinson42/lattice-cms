---
status: accepted
strength: default
date: 2026-11-20
revisit: Type-check time or editor latency becomes a problem, or generated behavior is hard to debug.
---

# 0003. Collections compile into hexok and ts-pf at runtime

## Decision

`collection()` and `build()` create hexok `UseCase` classes, event catalogs and a ts-pf router at startup. Types are inferred from the collection's schema. There is no code generation and no generated files in the repository.

## Why

The least code in a product repo, and nothing to regenerate or forget. Every generated operation stays replaceable by a hand-written use case with the same types (`.override()`), so a team that outgrows a collection drops to plain hexok without leaving Lattice.

## Rejected

- CLI scaffolding of plain files: no runtime magic, but many more files per collection to keep in step.
- Both, with an eject command: two paths to maintain before either is proven.
