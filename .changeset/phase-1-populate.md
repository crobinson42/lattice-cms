---
'@latticecms/core': minor
---

Reads take `populate`. `get` populates ref fields and `many()` relations, `find` populates ref fields, and a relation's `list` populates its links' refs. Each target collection is read once per call with `getMany`, under the caller's read access and tenant there and through its `afterRead`; a document the caller may not read, or one that is gone, comes back as `Withheld` (`{ id }`). The output types follow `populate` on every ts-pf client and on `useCases`, through ts-pf 0.6.0's expandable outputs. An overridden read takes no `populate`.

Requires `@ts-pf/*` 0.6.0. Exports the `Withheld` and `ReadUseCase` types, and the `Ref` and `JoinShape` types, which an app's declaration files name when it exports a collection with a ref or a relation.

A `many()` relation declared without `fields` or `onDelete` now keeps `many()`'s defaults inside `collection({ relations })`; before, its link type had an index signature. A link field named like a ref field, a reserved name or the tenant field is now a compile error as well as a throw.
