---
'@latticecms/core': minor
---

First release. Collections that compile into hexok use cases, hexok event classes and a ts-pf contract. Every generated piece is a real hexok `UseCase`, `Event`, `Errors` and `Port`, and a real ts-pf `router`, so a hand-written one can take its place with the same types.

- `collection()`: a Zod schema with a slug, `beforeChange` and `afterRead` hooks, declared indexes, refs with `onDelete` (`restrict`, `cascade`, `nullify`), `many()` relations through a derived join collection, and maskable fields. Each collection derives its `created`, `updated` and `deleted` event classes.
- `family()`: the app's one hexok use case family. It parses the actor once, checks input and access before every `execute`, writes one log line per call, and gives each call its tenant through `tenantOf`, or a read-only bypass.
- `framework()` and `.collection()`: a typed ts-pf contract with `find`, `count`, `get`, `create`, `update` and `delete` per collection, `list` and `set` per relation, and the app's overrides and methods. A client needs no annotations. Each generated procedure carries a summary and an MCP effect, so `@ts-pf/openapi`, `@ts-pf/codegen` and `@ts-pf/mcp` describe it with no code.
- `build()`: the implemented router, the use cases, a typed `Repo` per collection, `onError` for `FetchHandler`, `context()` for direct calls, and `ensure()` for indexes.
- Access is a filter in every query, through the `Access` port. Tenancy is a filter on every call. Population is typed per call through ts-pf's expandable outputs; a document the caller may not read is `Withheld`. Field masking decides per actor which maskable fields a client receives, and refuses a query on a withheld one.
- OpenTelemetry spans for each procedure and each use case, through `@opentelemetry/api`.
- `MemoryStore`, the `CollectionStore` port, and `@latticecms/core/store` and `@latticecms/core/store/conformance` for store adapters.

Install the peers in the app, so it and Lattice share one copy of each: `npm install @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server @ts-pf/docs @ts-pf/mcp zod @hexok/logger @opentelemetry/api`. See the [README](./README.md#install).

Known limits, listed in [architecture.md](../../docs/architecture.md#known-limits):

- No `@hexok/authz` adapter for `Access` yet. Authentication is the app's, at its edge.
- A collection cannot relate to itself with `many()`. `restrict` counts soft-deleted children. Population is one level deep, and `find` populates refs only.
- `Repo.update` writes its patch without re-validating the merged document.
- One store serves every collection. `MemoryStore.transaction` does not isolate calls made outside `work`.
- A field rule sees the actor, not the row.
- A use-case span cannot parent its store calls until hexok has a hook around `execute`.
