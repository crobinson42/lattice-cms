# Phase 2: Production wiring

Phase 2 takes Lattice from a tested example to an internal tool in production. It adds real authentication and authorization, field masking, the integration and webhook recipes, MCP and OpenAPI, and OpenTelemetry spans. Then one tool ships on it. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] One internal tool, named by the maintainer at step 1, runs in production on published `@latticecms/*` packages.
- [ ] `examples/crm` authenticates through `@hexok/auth`, with no dev headers outside tests.
- [ ] Authorization runs through the `Access` port, with an `@hexok/authz` adapter if hexok ships it in this phase, and list checks stay query filters (0005).
- [ ] Every procedure, use case and store call emits an OpenTelemetry span. A test reads them from an in-memory exporter.
- [ ] The crm serves MCP and an OpenAPI document from the same contract, and a client still needs no casts or annotations.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root. Type-check time is re-measured against 0003.

## In scope

The `@hexok/auth` recipe and the active organization, an `@hexok/authz` `Access` adapter, field-level read masking, OpenTelemetry spans, the integration-events and webhooks recipes with a crm worker, MCP and OpenAPI, the first publish, and the production pilot.

## Out of scope

The admin, the CLI, uploads (Phase 3), the outbox, versions and drafts, Postgres, and a store per collection (Phase 4). Do not add options for them.

## Steps

Each step ends with its tests passing. Tick it in this file when it does.

### 1. The pilot and the release path **Checkpoint**

- [ ] The maintainer names the internal tool that exits this phase, and what it needs from Lattice that this plan lacks.
- [ ] Settle the dependency ranges for the first publish:
  - store-mongo's peer range on core, which is `*` today;
  - whether `hexok` and `@ts-pf/*` become peers of core and store-mongo.

  Propose, and ask before anything is published.

### 2. Authentication **Checkpoint**

- [ ] The `@hexok/auth` recipe, as hexok's `app-template` does it: a credential at the edge becomes the actor, and the crm drops its dev headers outside tests.
- [ ] The active organization: how the edge picks it from the session or a header, and checks membership, before `tenantOf` reads it.
- [ ] Revisit `CallContext`'s "valid actor" typing (`architecture.md`, Authentication).

Read `@hexok/auth`, `auth-jose` and `auth-redis` first. Propose before building.

### 3. Authorization **Checkpoint**

- [ ] Find out whether `@hexok/authz` exists, or is planned for this phase; it is not in `../hexok/packages` today. If it is not, propose with the maintainer: wait, ask hexok, or keep the declared access functions for the pilot.
- [ ] With authz: an adapter of the `Access` port whose list checks return a filter. Decide how it composes with the access functions declared at `.collection()`; today `build({ access })` replaces them wholesale.

### 4. Field-level read masking **Checkpoint**

- [ ] `fields: { salary: { read } }`, or the shape the design settles on. Output types cannot follow the actor, so decide what a masked field's type is: optional, `Withheld`-like, or a separate read.
- [ ] Masking applies to `get`, `find`, `list`, population and events' `doc`. A filter or sort on a masked field must not leak it.

### 5. Tracing

- [ ] One span per procedure (ts-pf server call interceptor), one per use case (`preExecute` and `onFinally`), and one per store call (inside MongoStore), through `@opentelemetry/api`, following OpenTelemetry names.
- [ ] Tests use an in-memory exporter. A no-op without an SDK costs nothing measurable.

### 6. Events out of the product

- [ ] A crm worker process, shaped like `app-template`'s, consumes the domain event queue.
- [ ] The integration-events recipe: one domain event mapped to a versioned `@hexok/integration-events` message at the edge.
- [ ] The webhooks recipe: a handler that publishes through `@hexok/webhooks` with its own catalog, so internal fields never reach a customer.

### 7. MCP and OpenAPI

- [ ] The crm serves MCP through `@ts-pf/mcp`. Each operation is a tool, under the caller's access and tenancy.
- [ ] An OpenAPI document through `@ts-pf/openapi` with `profile: 'codegen'`, including `x-ts-pf-expand` for populated reads.

### 8. The pilot

- [ ] The tool named at step 1 runs in production on the published packages. Record what it needed that Lattice lacked, in Discoveries.

### 9. Docs

- [ ] The package READMEs, with recipes from `examples/crm`.
- [ ] `docs/architecture.md` matches what was built, and its Phase 2 markers are removed.
- [ ] Changesets.

## Carried from Phase 1

Candidates, not commitments. Each needs a reason from this phase's work before it is picked up. `architecture.md` "Known limits" lists them all.

- **ts-pf follow-ups:** a distributive `RouterImplCheck` (drops `rootRouter()`), and exported `ExpandResult` and `ExpandedOutput` (drops `ReadUseCase`). A brief was handed to the maintainer. When ts-pf releases either, bump `@ts-pf/*` and remove the workaround.
- **hexok `EventClass`:** when hexok exports it, type `Collection.events` with it.
- **Soft deletes and `restrict`:** an archived child still blocks deleting its parent.
- **`Repo.update`:** it does not re-validate the merged document.
- **Self `many()`:** it needs a naming rule.
- **Overloads:** 8 asserted overloads today (`architecture.md`, Repository and packages). Watch the count.

## Discoveries

Add a line here when the work teaches something the plan did not know. Each line says what was found and where it went.

- None yet.
