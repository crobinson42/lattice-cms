# Phase 2: Production wiring

Phase 2 takes Lattice from a tested example to an internal tool in production. It adds real authentication and authorization, field masking, the integration and webhook recipes, MCP and OpenAPI, and OpenTelemetry spans. Then one tool ships on it. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [x] `@latticecms/core` and `@latticecms/store-mongo` 0.1.0 are ready to publish through CI, and `examples/crm` is the reference app, runnable locally from its README. The maintainer chose this over a production pilot: the crm is an example, not a product.
- [x] `examples/crm` authenticates through `@hexok/auth`, with no dev headers outside tests.
- [x] Authorization runs through the `Access` port, with an `@hexok/authz` adapter if hexok ships it in this phase, and list checks stay query filters (0005).
- [x] Every procedure, use case and store call emits an OpenTelemetry span. A test reads them from an in-memory exporter.
- [x] The crm serves MCP and an OpenAPI document from the same contract, and a client still needs no casts or annotations.
- [x] `npm run lint`, `type-check`, `test` and `build` pass at the root. Type-check time is re-measured against 0003.

## In scope

The `@hexok/auth` recipe and the active organization, an `@hexok/authz` `Access` adapter, field-level read masking, OpenTelemetry spans, the integration-events and webhooks recipes with a crm worker, MCP and OpenAPI, the first publish, and the production pilot.

## Out of scope

The admin, the CLI, uploads (Phase 3), the outbox, versions and drafts, Postgres, and a store per collection (Phase 4). Do not add options for them.

## Steps

Each step ends with its tests passing. Tick it in this file when it does.

### 1. The pilot and the release path **Checkpoint**

- [x] The pilot: the maintainer chose the crm, and then kept it an example (step 8).
- [x] Settle the dependency ranges for the first publish ([0029](../decisions/0029-hexok-and-ts-pf-are-peers.md)):
  - `hexok` and the `@ts-pf/*` packages core imports become peers (and devDependencies) of core, and `hexok` of store-mongo;
  - store-mongo's peer range on core becomes `^0.1.0`, from `*`;
  - every package publishes with `access: public`.

  Nothing is published until the maintainer says so.

### 2. Authentication **Checkpoint**

Built: [0030](../decisions/0030-the-edge-checks-membership-per-request.md).

- [x] The `@hexok/auth` recipe: `Sessions` with a `JoseSessionToken`, Redis in dev and production and memory in tests. The crm's dev headers are deleted.
- [x] The active organization: `x-organization-id`, checked against a `memberships` collection on every request before `tenantOf` reads it. Support comes from the `CRM_SUPPORT_USER_IDS` config list.
- [x] Revisit `CallContext`'s "valid actor" typing: kept. The edge refuses, and anonymous procedures live on their own router.
- [x] Password login, on its own ts-pf router at `/auth`. The hashes never reach the Lattice router, MCP or OpenAPI. scrypt (OWASP parameters, PHC format), with a per-email failure limit.

### 3. Authorization **Checkpoint**

- [x] Find out whether `@hexok/authz` exists. It does not. Three competing designs sit on unmerged hexok branches (`authz-claudes-plan`, `authz-groks-plan`, `authz-chatgpts-plan`). The maintainer chose to keep the declared access functions for the pilot.
- [ ] Deferred until hexok releases `@hexok/authz`: an adapter of the `Access` port whose list checks return a filter, and how it composes with the access functions declared at `.collection()`. Today `build({ access })` replaces them wholesale. Do not design the composition before there is an adapter to compose.

### 4. Field-level read masking **Checkpoint**

Built: [0031](../decisions/0031-masked-fields-are-withheld-at-the-client-boundary.md). The crm's type-check with tests is 0.56–0.58 s, core sources +0.6% instantiations.

- [x] `collection({ maskable })`, `clientOutput` and `ClientDoc<C>`; `.collection(C, { fields: { f: { read } } })`; `Access.readable`, failing closed. A withheld field is absent, and optional in client types.
- [x] Masking at the implemented router covers get, find, list, population, overrides, methods, and create and update responses. Maskable fields are found by a field-schema marker. Repos, direct `useCases` and events stay whole.
- [x] A `where` or `sort` on a withheld field is `VALIDATION`, and a unique index on a maskable field throws. A bisection test proves no leak, with teeth.
- [x] The crm: a membership `role`. Members see deals without `amount`; managers and support see it.

### 5. Tracing

- [x] One span per procedure (a middleware on Lattice's router, so every caller gets it with no wiring; ts-pf's call interceptors attach to callers, not routers), one per use case (`preExecute` and `onFinally`; hexok has no around hook, so a use case's store calls are its siblings under the procedure span, not its children), and one per store call (inside MongoStore), through `@opentelemetry/api`, following OpenTelemetry names.
- [x] Tests use an in-memory exporter. A no-op without an SDK costs nothing measurable.

### 6. Events out of the product

- [x] A crm worker process, shaped like `app-template`'s, consumes the domain event queue.
- [x] The integration-events recipe: one domain event mapped to a versioned `@hexok/integration-events` message at the edge. It needed `@hexok/integration-events` 0.2.2, which exports `MessageClass` (hexok PR #33).
- [x] The webhooks recipe: a handler that publishes through `@hexok/webhooks` with its own catalog, so internal fields never reach a customer.

### 7. MCP and OpenAPI

- [x] The crm serves MCP through `@ts-pf/mcp`. Each operation is a tool, under the caller's access and tenancy.
- [x] Core attaches per-action metadata to generated procedures, a `docs` summary and an `mcp` effect, with `@ts-pf/docs` and `@ts-pf/mcp` as peers (approved by the maintainer). A maskable field's `where` and `sort` entries say they are refused for a caller who cannot read it (0031).
- [x] An OpenAPI document through `@ts-pf/openapi` with `profile: 'codegen'`, including `x-ts-pf-expand` for populated reads.

### 8. The release path

The maintainer chose the crm as the pilot, then decided it stays an example, not a production tool. This step became the release path instead.

- [x] CI runs the four checks on pull requests and pushes to main. The Release workflow opens "Version Packages" from `.changeset/`, and merging it publishes with provenance, as hexok does.
- [x] Both packages carry `repository` for `crobinson42/lattice-cms`, which provenance requires. The changelog is `@changesets/changelog-github`.

### 9. Docs

- [x] The package READMEs, with recipes from `examples/crm`.
- [x] `docs/architecture.md` matches what was built, and its Phase 2 markers are removed.
- [x] Changesets.

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

- core's emitted `.d.ts` failed under `skipLibCheck: false` (a distributive `RelationsOf` in `collection()`'s return type). Root `skipLibCheck: true` hid it. Fixed in task 2.1b, with a check over the built declarations in the four checks.
- The packages had no license. The maintainer chose MIT, matching hexok and ts-pf (task 2.1b).
- In the workspace, npm does not check a linked package against a peer range. Only a packed install catches a wrong internal peer range.
- Lattice validated the actor but passed the raw object on, so a non-strict schema let a stripped key (such as `support`) reach `tenantOf`. Task 2.2b parses it once and passes the parsed actor on.
- hexok's `@hexok/auth`, `auth-jose` and `auth-redis` depend on `hexok` directly, not as a peer: the second-copy risk 0029 avoids. A note for hexok, held for the maintainer.
- ts-pf's call interceptors attach to callers (`FetchHandler`, `createLocalClient`), not routers, so Lattice's procedure span is router middleware. hexok has no around hook, so a use-case span cannot parent its store calls. A note for hexok, held for the maintainer.
- OpenTelemetry's sdk-trace-base 2.12 caps the API below 1.10, so Lattice's devDependency is `~1.9.1`. Its peer range, `^1.3.0`, accepts both.
- ts-pf note, held for the maintainer: `@ts-pf/mcp` maps an effect to `readOnlyHint` and `destructiveHint` only, and leaves `openWorldHint` at the MCP default, true, which is wrong for a closed app.
- hexok notes, held for the maintainer: app-template's subscribe helper casts, and the crm's typed one does not; hexok has no public memory queue that delays and retries, so the crm has one in its tests; no hexok queue, webhooks or integration-events package makes OpenTelemetry spans, so the crm worker makes its own job span.
- Turbo ignores `peerDependencies` when ordering builds, so store-mongo keeps `@latticecms/core` as a devDependency too.
