---
status: proposed
strength: default
date: 2026-11-25
revisit: A populated read's type cost hurts a real app (a type-check budget it cannot meet, or an editor that lags), or TypeScript changes how inferred intersections instantiate.
---

# 0038. A ref names its target by slug, and populated reads keep their type slope

## Decision

- `ref('companies')` keeps naming its target by slug. A collection file imports no other collection.
- A populated read (`get`, `find` with a ref) costs about 90 type instantiations more for each collection in the app: about 3.6k per read at 9 collections, and 5.6k at 24. Writes and reads with no refs are flat. Lattice accepts that slope.
- `npm run type-cost` in core guards it in CI. It fails if a read's cost from 6 to 24 collections grows more than 10% past today's ratio (1.58), or if a write's cost grows at all beyond 10%.

## Why

The slope comes from the entries map that the `.collection()` chain builds by inference. Passing that map, or anything derived from it, into the read types (`Read`, `Wide`, `Expanded`) is the whole cost, even when they only look up a target. The same map written by hand, printed identically, is flat, through the same `Framework` class. Thirteen changes to core's read types each still grew. Each of these still grew: a per-collection targets map, one shared map, a union of `[slug, doc]` pairs, an inline mapped type, the map flattened once, entries rebuilt at the contract, an entry alias, and a constant target document. The only flat shape found keeps the map out of the read types entirely.

Keeping the map out means a ref must carry its target's type itself, `ref(Companies)`. That changes a public API, makes every collection file import its targets, and brings back the declaration cycles that [0018](0018-methods-and-overrides-attach-in-the-framework.md) removed: a self-ref or a mutual ref fails with TS7022. At the crm's size, the slope costs about 18k of a 499k check.

## Rejected

- **`ref(Companies)` or `ref<typeof Companies>('companies')`.** Flat, but it costs the cycle and an API change for about 4% of an app's check.
- **Recomputing the read types from a targets map, a flattened map, or entries rebuilt at the contract.** Each still grew. Measured, so nobody needs to try them again.
- **No guard.** The slope would drift unnoticed. hexok's `family()` statics and ts-pf's `all()` both did, until a crm step tripped a budget.
