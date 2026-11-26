# Brief for ts-pf: `all(tk)`'s type cost on a large contract

For the ts-pf maintainers, from Lattice CMS. Measured on `@ts-pf/mcp` 1.0, TypeScript 6, 2026-11-25.

## Outcome (2026-11-25)

The first reading of this brief was wrong, and ts-pf's investigation corrected it.

- Lattice's procedure types cost O(N) each on their first deep evaluation. The reads (`get`, `find`) grow about quadratically in total, through types generic over the whole entries map. `all()` was the first consumer to evaluate every procedure deeply. Lattice measured its side and accepted it, guarded by `npm run type-cost` ([0038](../decisions/0038-a-ref-names-its-target-by-slug-and-populated-reads-keep-their-type-slope.md)).
- ts-pf also cut `all()`'s own overhead: its effect and docs filters now share one match against the tool builder. On Lattice's fixture, `all()`'s share fell from 35.0k to 17.6k at N = 6, and from 105.2k to 42.8k at N = 12 (crobinson42/ts-pf#74, a patch with no API change).
- A plain ts-pf contract of N routers stays linear under `all(tk)`.

The rest of this brief is the original report.

## The problem

`$toolset({ tools: [all(tk)] })` costs more type instantiations per procedure as a contract grows. The type is `AllTools` and `Selected` in `packages/mcp/src/all.ts` (around lines 100-125): a key-remapped mapped type over `Selected<…>`, which filters the union of every leaf tool (`LeafTools<N>`), with `ToolName` and `Injected` applied to each member. The per-procedure cost rises with the number of procedures, so the total is quadratic.

## The measurements

A Lattice app with N plain collections, six procedures each. Only `all(tk)`'s share is shown, as the difference against the same app with only `createToolkit(contract)`:

| N (procedures) | `all(tk)` alone | Per collection |
| --- | --- | --- |
| 6 (36) | 35.7k | 6.0k |
| 7 (42) | 44.6k | 6.4k |
| 12 (72) | 106.5k | 8.9k |

For comparison, over the same range:

- `createToolkit(contract)` grows about linearly, at 9-14k per collection.
- `$toolset` adds about 8k, flat.
- `$coverage` adds about 2k, flat.
- Calling `all(tk.slice)` once per slice is worse: 409k at N = 12.

In Lattice's terms, every app with MCP pays about 1.3k more per collection for each collection it already has: the 7th costs about 24k for MCP, and the 12th about 32k. Lattice's own types stay flat at about 4k per collection.

## A direction

Make `AllTools` linear in the number of leaves. One option is to build it from the toolkit's already-named tools, instead of remapping a union of leaves through `ToolName`. Another is to compute `Selected` once per node and reuse it. The comment above `AllTools` says the filtering was already moved out of the `as` clause for this reason. The remaining cost seems to be the key remapping over a large union, which TypeScript evaluates per member against the whole union. No API change is needed.

## The repro

A contract with N routers of six procedures each. Measure `npx tsc --noEmit --extendedDiagnostics` for N = 6, 7 and 12, with and without the `all` line:

```ts
import { createToolkit, all } from '@ts-pf/mcp';
// contract: router({ c0: { get, find, count, create, update, delete }, c1: { … }, … })
const tk = createToolkit(contract).$context<Ctx>();
export const tools = tk.$toolset({ tools: [all(tk)] }); // the quadratic part
```

Lattice can supply its fixture generator, which writes a Lattice app with N collections and each variant.

## What Lattice needs

A release where `all(tk)`'s cost per procedure is flat. Lattice re-measures its type budgets when it lands.
