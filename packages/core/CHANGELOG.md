# @latticecms/core

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
