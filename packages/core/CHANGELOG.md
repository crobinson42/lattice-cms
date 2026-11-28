# @latticecms/core

## 0.3.0

### Minor Changes

- [#4](https://github.com/crobinson42/lattice-cms/pull/4) [`66d2468`](https://github.com/crobinson42/lattice-cms/commit/66d246810820613c55450be4e8ff5129265b69af) Thanks [@crobinson42](https://github.com/crobinson42)! - `Where` gains `nhas` on arrays of strings, numbers or enum values: it matches an array with no element equal to its value. A missing or null array has none, so `nhas` matches it; add `exists: true` to require the array. It lets an access function refuse by membership, such as `{ blockedOrgIds: { nhas: actor.orgId } }`, inside the query.

  For store adapters: `FieldOps` has `nhas`, and the conformance suite has cases for it.

  `has` and `nhas` refuse a null operand with `VALIDATION`, even when the array's element schema allows null. Mongo matches a missing array with `has: null`, the reverse of "a missing array has no elements".

## 0.2.0

### Minor Changes

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`74c37fe`](https://github.com/crobinson42/lattice-cms/commit/74c37fe5e237f0918de593cb358b7b4da0861a3d) Thanks [@crobinson42](https://github.com/crobinson42)! - `sort` takes optional and nullable string, number and enum fields. A document with no value, missing or null, comes after every document with one, ascending or descending, and documents with no value order by the remaining keys, then `id`. The cursor records a missing value as `null`, so pages stay stable across the boundary.

  For store adapters: `FindQuery` has a new required `optional`, the sort fields a document may lack, and `orderOf(sort, optional)` takes it. Each `Order` key says whether it is optional, and `after`, `encodeCursor` and the new `cursorValues` handle a missing value. The conformance suite has cases for it.

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`03059f7`](https://github.com/crobinson42/lattice-cms/commit/03059f79c707c3e71ba2f507d38f6c2611cf797e) Thanks [@crobinson42](https://github.com/crobinson42)! - An override can call the generated operation it replaces. `build()`'s overrides factory receives `generated` beside `repos`, holding only the overridden operations: `generated.<slug>.<operation>(ctx, input)`, and `generated.<slug>.<relation>.<op>` for a relation, runs that operation's body: the input parse, the access scope, hooks, the store write and its events. It runs no guards, logging or spans, which the override's own use case has run, so each runs once. Each body checks what its own action needs (create's access, withheld fields, populate keys), so calling one from another operation's override skips nothing. An override that adds a rule checks the input, then returns `generated`. Core exports `CreateInput<C>` and `UpdateInput<C>`, the inputs of create and update, for the override's `execute`. An override of create now hands its access function the create-parsed data, with defaults applied, as the generated create does; before, it received the override's raw input.

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`e3fb0eb`](https://github.com/crobinson42/lattice-cms/commit/e3fb0ebe5e4bdb5268306b0e3f50f105977fbc90) Thanks [@crobinson42](https://github.com/crobinson42)! - `ref()` refuses an empty id with `VALIDATION` at its path, "Choose the company" in words from the slug's label, or "Choose one" when the label has no singular core can find. A required ref no longer needs `.min(1)`. A ref's JSON Schema says `minLength: 1`.

### Patch Changes

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`94d5203`](https://github.com/crobinson42/lattice-cms/commit/94d5203d35bb7109b415da436c6b7c48cb930509) Thanks [@crobinson42](https://github.com/crobinson42)! - Requires hexok 2.2.8 as a peer, which fixes `family()`'s statics check: a collection's first hand-written use case no longer costs an app about 38k type instantiations.

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`1fb7e25`](https://github.com/crobinson42/lattice-cms/commit/1fb7e2508b8ab2832e92759a0da64ec96845b828) Thanks [@crobinson42](https://github.com/crobinson42)! - A collection whose schema has an object-level `.refine()` now builds with refs and maskable fields. Its output schemas are built from the schema's fields, so they no longer carry the refinement, which Zod 4 refused to extend for populated reads and masked fields. The refine still checks create, and the merged document of an update.

## 0.1.0

### Minor Changes

- [`355f2b5`](https://github.com/crobinson42/lattice-cms/commit/355f2b5d9ec18ccd637d861abc5639ea036e7ae2) Thanks [@crobinson42](https://github.com/crobinson42)! - First release. Collections that compile into hexok use cases, hexok event classes and a ts-pf contract. Every generated piece is a real hexok `UseCase`, `Event`, `Errors` and `Port`, and a real ts-pf `router`, so a hand-written one can take its place with the same types.

  - `collection()`: a Zod schema with a slug, an optional `label`, `beforeChange` and `afterRead` hooks, declared indexes, refs with `onDelete` (`restrict`, `cascade`, `nullify`), `many()` relations through a derived join collection, and maskable fields. Each collection derives its `created`, `updated` and `deleted` event classes.
  - `family()`: the app's one hexok use case family. It parses the actor once, checks input and access before every `execute`, writes one log line per call, and gives each call its tenant through `tenantOf`, or a read-only bypass. A use case's `input` and `output` take any Zod schema.
  - `framework()` and `.collection()`: a typed ts-pf contract with `find`, `count`, `get`, `create`, `update` and `delete` per collection, `list` and `set` per relation, and the app's overrides and methods. A client needs no annotations. A method declares `summary` and `effect` statics; an override keeps the operation's.
  - `update` takes a patch: a field left out keeps its value, and `null` clears an optional field. The merged document is validated with the whole schema. A delete a reference restricts is `REFERENCED`, naming what refers to the document, and the relation when it is a `many()` relation's link.
  - `build()`: the implemented router, the use cases, a typed `Repo` per collection, `onError` for `FetchHandler`, `context()` for direct calls, and `ensure()` for indexes.
  - Access is a filter in every query, through the `Access` port. Tenancy is a filter on every call. Population is typed per call through ts-pf's expandable outputs; a document the caller may not read is `Withheld`. Field masking decides per actor which maskable fields a client receives, and refuses a query on a withheld one, or an update of it.
  - The catalog describes the app to clients such as `@latticecms/admin`: each procedure's summary (naming the collection by its label), MCP effect and `lattice` meta (`LatticeMeta`), and `x-lattice-ref`, `x-lattice-maskable` and `x-lattice-tenant` in its JSON Schema. A sort is an enum of the keys a collection can sort by. `@ts-pf/openapi`, `@ts-pf/codegen` and `@ts-pf/mcp` describe the app with no code.
  - OpenTelemetry spans for each procedure and each use case, through `@opentelemetry/api`.
  - `MemoryStore`, the `CollectionStore` port, and `@latticecms/core/store` and `@latticecms/core/store/conformance` for store adapters.
  - For tools such as `@latticecms/cli`: `labelOf(slug)`, `reservedNames` and `reservedFields`.
  - The `lattice` agent skill, in `skills/lattice`: the steps from a collection to an override, and a reference per concept, each quoting the crm. `npx skills experimental_sync -y -r` links it.

  Install the peers in the app, so it and Lattice share one copy of each: `npm install @latticecms/core hexok@^2 @ts-pf/contract@^1 @ts-pf/protocol@^1 @ts-pf/server@^1 @ts-pf/docs@^1 @ts-pf/mcp@^1 zod@^4 @hexok/logger@^0.2 @opentelemetry/api@^1`. See the [README](./README.md#install).

  Known limits, listed in [architecture.md](../../docs/architecture.md#known-limits):

  - No `@hexok/authz` adapter for `Access` yet. Authentication is the app's, at its edge.
  - No file uploads yet.
  - A collection cannot relate to itself with `many()`. `restrict` counts soft-deleted children. Population is one level deep, and `find` populates refs only.
  - `Repo.update` writes its patch without re-validating the merged document.
  - One store serves every collection. `MemoryStore.transaction` does not isolate calls made outside `work`.
  - A field rule sees the actor, not the row.
  - A use-case span cannot parent its store calls until hexok has a hook around `execute`.
