---
status: accepted
strength: default
date: 2026-11-21
revisit: ts-pf can make an output field required only when an input flag is set, or a client cannot afford a second call per page.
---

# 0026. Totals come from a generated `count` procedure, not `find({ withTotal })`

## Decision

Every collection gets a generated `count` operation: `<slug>.count({ where? })` returns `{ count: number }`. It runs under the `read` access function and the tenant clause, like `find`. `Repo<C>` gains `count(where, scope)`. `find` takes no `withTotal` and returns no `total`. A client that needs both calls `find` and `count` in parallel.

## Why

A `total` that appears only when `withTotal` is set cannot be typed exactly. A ts-pf procedure has one output type, and expandable outputs ([0022](0022-populated-reads-use-ts-pf-expandable-outputs.md)) are keyed on a list of fields, not a flag. With `total?: number`, every caller must narrow, even after asking for it. A separate procedure has an exact type, keeps `find` to one query, and lets a list endpoint skip the count by not calling it.

## Rejected

- `find({ withTotal: true })` returning `total?: number`: one call, but an optional total the caller asked for.
- Both `withTotal` and `count`: two ways to do one thing.
