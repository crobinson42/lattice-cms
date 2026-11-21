---
status: accepted
strength: default
date: 2026-11-21
revisit: ts-pf declines expandable outputs, or its design cannot express a ref replaced inside a list (`find`'s `docs[]`).
---

# 0022. Populated reads are typed by ts-pf expandable outputs

## Decision

A read's output type follows its `populate` input through a ts-pf feature, expandable outputs: `procedure.output(Wide).expand({ key: 'populate', at: ['docs'], fields })`. The output schema is the wide type the server sends. ts-pf derives the plain type by removing `fields`, and gives the wide type when `populate` is not a literal list. Lattice's `contractOf` declares the expansion for `get` and `find`. Clients use ts-pf's own types, with no Lattice wrapper. A populated document the caller may not read is `Withheld`, `{ id }` only, so a populated ref types as `Doc<Target> | Withheld`, and callers narrow on it.

Lattice does not edit ts-pf ([0001](0001-build-on-hexok-and-ts-pf.md)). The feature is requested from ts-pf. Population (Phase 1 step 9) waits for its release.

## Why

ts-pf types each procedure as one non-generic call from input to output, so the output cannot follow `populate`. The Phase 1 type spike tried unions and intersections of procedures, and found no way around this inside Lattice. Only a ts-pf change gives exact types on every TypeScript client: local, HTTP, astro, mvc-kit and TypeScript codegen. `useSWR` narrows when its fetcher calls the procedure. Generators for other languages see the wide schema and an `x-ts-pf-expand` extension. It must be data-driven, because codegen prints types from the runtime catalog and cannot print a type function.

`Withheld` keeps population inside [0005](0005-access-and-tenancy-are-query-filters.md): the population query carries the access filter. A UI still has the id to show a restricted row.

## Rejected

- A wide output, where a ref is `string | Doc | Withheld`: every read narrows, unpopulated ones too, and OpenAPI gets a `oneOf` that Swift, Kotlin and Dart codegen handles poorly.
- A typed Lattice wrapper, `lattice.client(createLocalClient(…))`: the spike runs it, and it is the fallback if ts-pf declines. swr, mvc-kit and codegen clients keep the wide type, it adds an asserted overload, and it re-types ts-pf's client internals inside Lattice. Do not ship it ahead of the ts-pf feature: it would be a public API built to be removed.
- One procedure per populate shape (`posts.getWithAuthor`): it drops `populate: [...]`, the contract grows with each view, and the admin's dynamic populate falls back to the wide type.
- Populated documents ignore read access: that leaks documents through population.
- `null` for a withheld document: it loses the id, and an unpopulated read shows that id.
