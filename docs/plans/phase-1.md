# Phase 1: Mongo, relations, access, tenancy

Phase 1 puts the Phase 0 kernel on MongoDB and adds what a multi-tenant product needs: access filters, row-level tenancy, relations and population. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] `examples/crm` runs on Mongo through `@latticecms/store-mongo`, and its tests pass on both `MemoryStore` and `MongoStore`.
- [ ] Tenant isolation tests pass: no read, write, count, population or cursor reaches another tenant's rows, and every `tenancy.bypass` call is logged.
- [ ] One store conformance suite passes on `MemoryStore` and `MongoStore` alike.
- [ ] A client still needs no casts and no annotations, including on populated reads.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root. Type-check time is re-measured against 0003.

## In scope

The `Access` port and its default adapter, `tenant` and `tenantOf`, `tenancy.bypass`, `ref()`, `many()` and join collections, `populate`, `onDelete`, `withTotal` and `count()`, `ensure()` and declared indexes, the migrations runner, the store adapter surface of `@latticecms/core`, and `@latticecms/store-mongo` with `MongoStore`, its `Where` translation and its client lifecycle.

## Out of scope

Auth recipes, `@hexok/authz`, field masking, MCP, OpenAPI, tracing (Phase 2), the admin, the CLI, uploads (Phase 3), the outbox, versions and drafts, Postgres (Phase 4). Do not add options for them.

## Files

New files only where a Phase 0 file would grow a second concern.

| Where | Holds |
| --- | --- |
| `packages/core/src/access.ts` | the `Access` port, the default adapter, and how its result merges into `scopeOf` |
| `packages/core/src/tenancy.ts` | the tenant clause, stamping, and `tenancy.bypass` |
| `packages/core/src/relations.ts` | `ref()`, `many()`, join collections, `onDelete` |
| `packages/core/src/populate.ts` | batched population and its output types |
| `packages/core/src/store/` | the store adapter surface and the conformance suite (step 4) |
| `packages/store-mongo/` | `@latticecms/store-mongo`: `MongoStore`, `Where` translation, mappers, client lifecycle, migrations runner |

## Steps

Each step ends with its tests passing. Tick it in this file when it does.

### 1. Type spike for relations, access and tenancy **Checkpoint**

The risk is types again: population changes output types per call.

- [ ] In a test file, the smallest `ref()`, `many()`, `tenant`, `access` and `populate` that type-check end to end: `local.posts.get({ id, populate: ['authorId'] })` returns `authorId` as the user type, and as `string` without `populate`.
- [ ] `populate` with a field that is not a relation is a type error. `access` functions are typed from the actor and the collection's `Where`.
- [ ] Measure type-check time on `examples/crm`-sized definitions.

Stop and show the maintainer the public signatures and one populated call site.

### 2. Access **Checkpoint**

- [ ] The `Access` port as `architecture.md` shows it, and the default adapter reading each collection's `access` functions. A missing function denies.
- [ ] The generated operations get their scope from `scopeOf` in `crud.ts`, the seam Phase 0 left: `true` means no clause, `false` throws `FORBIDDEN`, and a `Where` merges into the store call. A row outside the filter is `NOT_FOUND`.
- [ ] Decide how a method's access for its own action (`posts.publish`) runs. Family guards are fixed at `family()` and see only the call, so the `Access` instance must reach them through the call context or through `build()`. Propose before building.
- [ ] Decide whether access functions are the home for a default filter, such as hiding soft-deleted rows (Phase 0 found an archived deal still returned by `find`).

### 3. Tenancy

- [ ] `collection(slug, { tenant: 'organizationId' })` and `family({ tenantOf })`. Create stamps the tenant field, every filter adds it, and clients cannot set or change it.
- [ ] `tenancy.bypass(actor)` reads across tenants, and every bypassed call is logged with the actor and collection.
- [ ] Events carry `tenantId`, and log lines carry `tenantId`.
- [ ] Isolation tests through `createLocalClient` on `MemoryStore`: find, get, update, delete, cursors and events.

### 4. Store adapter surface **Checkpoint**

- [ ] A subpath export, `@latticecms/core/store`, with the port types (`StoredDoc`, `Patch`, `FindQuery`, `Page`), the parsed `Where` type, and the cursor helpers (`orderOf`, `after`, `encodeCursor`). The root export stays as it is.
- [ ] A store conformance suite that an adapter package runs against its own store: every port method, `where` honored, copies, cursors with ties, and `CONFLICT`. `MemoryStore` passes it.
- [ ] `ensure()` and `count()` join the port. `MemoryStore` implements both.

Stop and show the maintainer the subpath's exports and how an adapter runs the suite.

### 5. `@latticecms/store-mongo`

- [ ] A new package, set up as `AGENTS.md` "Adding a package" says. Pick the test database, a real Mongo process (such as `mongodb-memory-server`) or a container, and say why before adding it.
- [ ] `MongoStore` passes the conformance suite. `Where` translates one to one, because the matcher already follows Mongo's null and missing rules. The keyset is a `Where`, so it needs no code of its own. A duplicate key is `CONFLICT`. A `Mapper` maps `id` to `_id`.
- [ ] The Mongo client lifecycle lives in this package (`architecture.md`, proposed changes table).

### 6. Indexes, `count()` and `withTotal`

- [ ] Indexes declared on a collection. `ensure()` creates missing ones at startup and never drops one.
- [ ] `find({ withTotal: true })` adds `total` from a second `count` query.

### 7. Migrations runner

- [ ] Numbered TypeScript files, a `_migrations` collection recording what ran, and a Redis lock from `@hexok/schedule-coordinator-redis`, so two processes never run them at once. The CLI that calls it is Phase 3.

### 8. Relations

- [ ] `ref()` fields and `many()` relations with real join collections that get generated use cases, access (the parent's `update` access by default), tenancy, indexes and events.
- [ ] `<slug>.<relation>.list` and `.set` use cases and procedures.
- [ ] `onDelete`: `restrict` (default), `cascade` and `nullify`, in one transaction when the store supports it, otherwise in order with the parent last. Across stores, `cascade` and `nullify` are idempotent event handlers.

### 9. Population

- [ ] `populate` on reads, one level deep. Ids are collected per target collection, and `getMany` is called once each.
- [ ] Access and tenancy apply to populated documents. A populated document the caller may not read comes back as `{ id }` only.

### 10. `examples/crm` on Mongo

- [ ] `contacts.companyId` and `deals.companyId` become `ref('companies')`. The example runs on `MongoStore` and keeps its `MemoryStore` tests.
- [ ] Tenant isolation tests on Mongo.
- [ ] Decide whether `Repo.insert` should apply schema defaults like `create` does. Today it takes output data, so defaulted fields are required.

### 11. Docs

- [ ] `packages/core/README.md` and a `packages/store-mongo/README.md`, with examples from `examples/crm`.
- [ ] `docs/architecture.md` matches what was built, and its Phase 1 markers are removed.
- [ ] Changesets for both packages.

## Carried from Phase 0

- Six asserted overloads sit where runtime-built values meet precise types (`build`, `whereSchema`, `sortSchema`, `patchSchema`, `repo`, `contractOf`). Watch the count, and say why when it changes. Every asserted Zod-typed overload states both of Zod's type parameters, or ts-pf callers get `unknown`.
- hexok's `Event()` returns an anonymous class type, so consumer declarations inline each event class. When hexok exports a named `EventClass`, type `Collection.events` with it (`architecture.md`, proposed changes table).

## Discoveries

Add a line here when the work teaches something the plan did not know. Each line says what was found and where it went.

- None yet.
