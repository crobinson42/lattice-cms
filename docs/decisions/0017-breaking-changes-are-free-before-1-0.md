---
status: accepted
strength: lock
date: 2026-11-20
revisit: The first `@latticecms/*` release that another repository depends on.
---

# 0017. Before 1.0, breaking changes are free

## Decision

Until a product depends on a published `@latticecms/*` release, nothing has external callers. When the right fix means changing a public type, an API, a test or a decision, change it. Do not add a shim, an adapter, a compatibility flag or a second code path to work around existing code.

## Why

Early workarounds become permanent complexity. With no external callers, a refactor costs one PR, and a workaround costs every later reader.

When this record is superseded, the replacement says what compatibility Lattice then promises.
