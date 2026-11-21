# Phase 1: Mongo, relations, access, tenancy

Phase 1 puts the Phase 0 kernel on MongoDB and adds what a multi-tenant product needs: access filters, row-level tenancy, relations and population. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] `examples/crm` runs on Mongo through `@latticecms/store-mongo`, and its tests pass on both `MemoryStore` and `MongoStore`.
- [ ] Tenant isolation tests pass: no read, write, count, population or cursor reaches another tenant's rows, and every bypassed call is logged.
- [ ] One store conformance suite passes on `MemoryStore` and `MongoStore` alike.
- [ ] A client still needs no casts and no annotations, including on populated reads.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root. Type-check time is re-measured against 0003.

## In scope

The `Access` port and its default adapter, `tenant` and `tenantOf`, `tenancy.bypass`, `ref()`, `many()` and join collections, `populate`, `onDelete`, the `count` operation, `ensure()` and declared indexes, the migrations runner, the store adapter surface of `@latticecms/core`, and `@latticecms/store-mongo` with `MongoStore`, its `Where` translation and its client lifecycle.

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

- [x] In a test file, the smallest `ref()`, `many()`, `tenant`, `access` and `populate` that type-check end to end: `local.posts.get({ id, populate: ['authorId'] })` returns `authorId` as the user type, and as `string` without `populate`.
- [x] `populate` with a field that is not a relation is a type error. `access` functions are typed from the actor and the collection's `Where`.
- [x] Measure type-check time on `examples/crm`-sized definitions.

Stop and show the maintainer the public signatures and one populated call site.

Done. The spike is `packages/core/src/spike-relations.test.ts` and `src/fixtures/spike-relations.ts`. Later steps build the real code from it. Delete both when step 9 lands. The maintainer chose: access attaches at composition ([0021](../decisions/0021-access-attaches-at-composition.md)); populated types come from ts-pf expandable outputs, and a withheld document is `{ id }` ([0022](../decisions/0022-populated-reads-use-ts-pf-expandable-outputs.md)).

### 2. Access **Checkpoint**

- [x] The `Access` port as `architecture.md` shows it, and the default adapter reading the `access` functions given at `framework().collection(C, { access })` ([0021](../decisions/0021-access-attaches-at-composition.md)). A missing function denies. Return types are checked as the spike checks them: an inferred return, with its keys checked on the options object.
- [x] The generated operations get their scope from `scopeOf` in `crud.ts`, the seam Phase 0 left: `true` means no clause, `false` throws `FORBIDDEN`, and a `Where` merges into the store call. A row outside the filter is `NOT_FOUND`.
- [x] Decide how a method's access for its own action (`posts.publish`) runs: through the call context, with a required scope on every `Repo` call ([0023](../decisions/0023-access-reaches-use-cases-through-the-call-context.md)).
- [x] Decide whether access functions are the home for a default filter: yes, a `read` filter (0023).
- [x] Build 0023: `ctx.access`, the access guard, `build().context()`, the `Repo` scope argument and `unscoped`, `access` required at `.collection()`. `examples/crm` declares its access, and deals hide archived rows.

### 3. Tenancy

- [x] `collection(slug, { tenant: 'organizationId' })` and `family({ tenantOf })`. Create stamps the tenant field, every filter adds it, and clients cannot set or change it. A tenant field in the schema is a compile error, as in the spike.
- [x] A tenanted collection added to a framework whose family has no `tenantOf` is a compile error and a throw. The tenant field stays in the client `Where`: it is a no-op inside a tenant, and it filters under bypass.
- [x] `tenantOf` returning `tenancy.bypass` reads across tenants, read-only, and every bypassed call is logged with the actor and collection ([0024](../decisions/0024-tenant-bypass-is-decided-by-tenant-of.md)). `tenancy.scope(C, tenantId)` for event handlers. `unscoped` cannot insert into a tenanted collection.
- [x] Update never writes the tenant field. Today it would write a stored `organizationId` back as `undefined`.
- [x] Events carry `tenantId`, and log lines carry `tenantId`.
- [x] Isolation tests through `createLocalClient` on `MemoryStore`: find, get, update, delete, cursors and events.

### 4. Store adapter surface **Checkpoint**

- [x] A subpath export, `@latticecms/core/store`, with the port types (`StoredDoc`, `Patch`, `FindQuery`, `Page`), the parsed `Where` type, and the cursor helpers (`orderOf`, `after`, `encodeCursor`). The root export stays as it is.
- [x] A store conformance suite that an adapter package runs against its own store: every port method, `where` honored, copies, cursors with ties, and `CONFLICT`. `MemoryStore` passes it.
- [x] `ensure()` and `count()` join the port. `MemoryStore` implements both.

Stop and show the maintainer the subpath's exports and how an adapter runs the suite.

Decided at the Checkpoint:
- **The suite is data.** `@latticecms/core/store/conformance` exports `storeCases`, `{ name, run(store) }` objects that assert with `node:assert/strict`, so core takes no runner dependency. The adapter's own hooks give a fresh store, and it runs `it.each(storeCases)`. Rejected: a vitest `testing` subpath, which ties adapters to vitest's version; and a separate package, which is a whole package for about 300 lines.
- **`/store` exports** `CollectionStore`, the types `StoredDoc`, `Patch`, `FindQuery`, `Page`, `Index`, `AnyWhere` and `FieldOps`, and `orderOf`, `after`, `encodeCursor` and `Order`. It does not export the input schemas, `kindOf`, `matches` or `compareDocs`.
- **The new port methods** are `count(collection, where?)` and `ensure(collection, indexes: readonly Index[])`, where `Index = { fields, unique? }`.
- **`MemoryStore` enforces unique indexes** with Mongo's rule that a missing field counts as null.

### 5. `@latticecms/store-mongo`

- [x] A new package, set up as `AGENTS.md` "Adding a package" says. The tests run on `mongodb-memory-server`, a single-node replica set per run with a database per test ([0025](../decisions/0025-mongo-store-owns-its-client.md)).
- [x] `new MongoStore({ url, database, client? })` owns its client, with `start()`, `stop()` and `MongoStoreError` (0025). `mongodb` is a dependency, and `@latticecms/core` and `zod` are peers.
- [x] Core refuses schema field names that contain `.`, start with `$`, or are `_id`: a compile error where cheap, and a throw in `collection()`. Mongo reads them as paths, operators or the id.
- [x] The README documents two known differences from `MemoryStore`. Mongo orders strings by UTF-8 bytes, which differs from JavaScript only for U+E000–U+FFFF against astral characters. `contains` folds case differently outside ASCII.
- [x] `MongoStore` passes the conformance suite. `Where` translates one to one, because the matcher already follows Mongo's null and missing rules. The keyset is a `Where`, so it needs no code of its own. A duplicate key is `CONFLICT`. A `Mapper` maps `id` to `_id`.
- [x] The Mongo client lifecycle lives in this package (`architecture.md`, proposed changes table).

### 6. Indexes and the `count` operation

- [x] Indexes declared on a collection. `ensure()` creates missing ones at startup and never drops one.
- [x] A generated `<slug>.count({ where? })` returning `{ count: number }`, under `read` access and the tenant clause, and `Repo.count(where, scope)`. There is no `withTotal` ([0026](../decisions/0026-totals-come-from-a-count-procedure.md)).

### 7. Migrations runner

- [x] `migrate(store, migrations, { logger, lock? })` in store-mongo, per [0027](../decisions/0027-migrations-lock-in-the-database-they-migrate.md). Migrations are forward only, from an explicit list checked by id and name. `_migrations` records what ran. A transaction is opt-in per migration. The lock is a lease in `_migrations_lock`, not Redis, and a second process waits for it. The CLI that calls it is Phase 3.

### 8. Relations

Decided in [0028](../decisions/0028-relations-delete-in-a-store-transaction-as-system-work.md). Built in two parts.

8a. Refs and deleting a parent:
- [x] `ref(slug, { onDelete? })` with a check-based marker, arrays of refs, the unknown-slug check at `build()` and on `.contract`, and the `has` operator on arrays.
- [x] `CollectionStore.transaction(work)` on MemoryStore and MongoStore, with conformance cases.
- [x] `onDelete` in the generated delete: restrict (`REFERENCED`), cascade and nullify, as system work inside the parent's tenant.
- [x] Ref indexes in `ensure()`.

8b. `many()`:
- [x] Derived join collections with `list` and `set`, the parent's access, the parent's tenant, events in the catalog, join indexes, and nested overrides.
- [x] Name rules for relations.

### 9. Population

Uses ts-pf expandable outputs ([0022](../decisions/0022-populated-reads-use-ts-pf-expandable-outputs.md)), released in `@ts-pf/*` 0.6.0 (ts-pf PR #66). Bump every `@ts-pf/*` package together, then run `npx skills experimental_sync -y`.

- `.output(Wide).expand({ key: 'populate', at: ['docs'], fields })`. The output schema is the wide type the server sends, and `.expand()` comes after `.input()` and `.output()`.
- ts-pf derives the plain type by removing `fields`. A `populate` variable typed `K[]` gets the wide type.
- `Fields` holds output types. A hand-written procedure type is `ContractProcedure<I, O, E, M, I, Expansion<'populate', ['docs'], { authorId: User | Withheld }>>`.
- `useSWR` narrows when its fetcher calls the procedure: `useSWR(swr.posts.get.key({ input }), () => swr.posts.get(input))`. `InferExpandedOutput<typeof contract.posts.get, ['authorId']>` names the type elsewhere.
- Drop the spike's `GetClient`, `FindClient` and `LatticeClient`, and delete both spike files once population covers them.

- [x] `populate` on reads, one level deep. `get` populates refs and `many()` relations, while `find` and a relation's `list` populate refs only; `many()` on `find` is a type error and VALIDATION. Ids are collected per target collection, and `getMany` is called once each.
- [x] Access and tenancy apply to populated documents. A populated document the caller may not read, or one that no longer exists, comes back as `{ id }` only.
- [x] Remove `rootRouter()` in `build.ts` if ts-pf 0.6.0 offers a typed `router()` for an erased tree that mixes procedures and nested routers. Read ts-pf's router typing first; the ts-pf session is closed. If there is no typed path, write the exact ts-pf change for the maintainer, and keep `rootRouter()` with a comment saying why.
- [x] A link field named like a ref field, a reserved name or the tenant is a compile error, not only a throw.

### 10. `examples/crm` on Mongo

- [x] `contacts.companyId` and `deals.companyId` become `ref('companies')`. The example runs on `MongoStore` and keeps its `MemoryStore` tests.
- [x] Tenant isolation tests on Mongo.
- [x] `Repo.insert` takes the schema's input type and parses it like `create`: defaults apply and checks run. `Repo.update` writes its patch as given; matching generated update would cost a read and a race.

### 11. Docs

- [ ] `packages/core/README.md` and a `packages/store-mongo/README.md`, with examples from `examples/crm`.
- [ ] `docs/architecture.md` matches what was built, and its Phase 1 markers are removed.
- [ ] Changesets for both packages.
- [ ] Before the first publish, settle the dependency ranges:
  - `@latticecms/store-mongo` peers `@latticecms/core: "*"`, because core is 0.0.0, and changesets bumps a dependent with a major when its peer range changes;
  - core and store-mongo each depend on `hexok`, which an app also depends on directly, so decide whether `hexok` and `@ts-pf/*` should be peers.

## Carried from Phase 0

- Six asserted overloads sit where runtime-built values meet precise types (`build`, `whereSchema`, `sortSchema`, `patchSchema`, `repo`, `contractOf`). Watch the count, and say why when it changes. Every asserted Zod-typed overload states both of Zod's type parameters, or ts-pf callers get `unknown`.
- hexok's `Event()` returns an anonymous class type, so consumer declarations inline each event class. When hexok exports a named `EventClass`, type `Collection.events` with it (`architecture.md`, proposed changes table).

## Discoveries

Add a line here when the work teaches something the plan did not know. Each line says what was found and where it went.

- ts-pf's `ProcedureClient` is one non-generic signature, so a read's output cannot follow `populate` from inside Lattice. Went to 0022 and the architecture's proposed changes table.
- TypeScript does not check excess properties on an object literal an arrow function returns, so `() => ({ authorID: … })` passes as `Where<Doc>`. Access checks inferred return types on the options object. Went to 0021.
- A template literal around a key union (`` `${K}` ``) makes a compile error print the union instead of the alias name. Use it wherever a key list reaches an error message.
- A computed key (`{ [tenant]: z.string() }`) types as an index signature, so the tenant shape needs one asserted overload. Expected count after Phase 1: 7.
- A hexok guard can throw but cannot hand `execute` a value (`use-case.ts` `installExecute`), so access reaches `execute` on the call context. Went to 0023.
- Generated `create` asks access only in the guard, with `data`, and never keeps the answer. So step 3 needs the tenant clause apart from the access answer: `CallAccess` can build each `Scope` from the tenant clause ANDed with the access `Where`, keeping the tenant clause for create, and `Repo.insert` stamps the tenant from its scope.
- An edge types its context as `CallContext<Actor>`, not `UseCase.Ctx<family>`, which now includes `access`. Went to `architecture.md`.
- `Scope` needs an ES private field to be nominal; with public fields only, a plain object passes as an unfiltered scope.
- `tenantOf` returning `null` or `''` at runtime would have matched or stamped rows no tenant owns. `CallAccess` fails closed unless it gets a non-empty string or `tenancy.bypass`. Went to `architecture.md`.
- `Repo.insert` never takes `unscoped` on a tenanted collection, so the step 7 migrations runner and any step 10 seed must name the tenant with `tenancy.scope(C, tenantId)`.
- Threading `Tenant` through `Collection`, operations, hooks and events raised the untenanted crm's check from 0.39 s to 0.47 s (+47k instantiations). Core is now 1.26 s. Re-measure at step 10; if crm passes about 0.6 s, look for a cheaper form. Asserted overloads: 7 (`tenantShapes`).
- The conformance suite has 34 cases. Four deliberately broken stores fail 10 of them. `MemoryStore` rejects an index whose keys exist with other options, as Mongo does. Changing an index is a migration.
- The package-name import of `@latticecms/core/store` gets its permanent test in `packages/store-mongo` (step 5). A core test cannot do it, because core's own tests do not build core first.
- All 35 `storeCases` passed on `MongoStore` on the first run: Mongo and the matcher never disagreed. Merging filters by spread fails the new where-on-id case. Empty `or` is `{ $expr: false }`.
- npm 12 skips install scripts, so mongodb-memory-server downloads mongod on the first test run. Turbo's strict env does not pass `MONGOMS_*`. CI should cache `~/.cache/mongodb-binaries`. There is no CI workflow yet.
- Core type-check has grown from 0.87 s to 1.37 s over steps 1–6 (842k instantiations); crm 0.49 s. The sixth generated operation (`count`) cost about 0.1 s in core.
- Mongo rejects `$expr` in an upsert's query, so the migrations lease is acquired by a `findOneAndUpdate` pipeline whose fields `$cond` on `$lt: ['$expiresAt', '$$NOW']`; the returned token says who holds it. With `transaction: true`, the driver may retry `up`, which is one more reason `up` must be safe to re-run.
- Zod's checks (`.min()`, `.trim()`) clone a schema and drop own properties, so a ref marker on the instance was lost. It is a no-op check now. Went to `architecture.md`.
- A cascade into a collection that overrides `delete` would hard-delete what the app soft-deletes, so it is a compile error. Conformance cases that need transactions carry `needs: ['transactions']`; a standalone MongoStore runs the other 37.
- After 8a: core type-check 1.76 s (1.60 s without relations.test.ts), crm 0.49 s, store-mongo 0.30 s. Asserted overloads: 7.
- ts-pf's router types read a node that may be a procedure or a router as a procedure, so the erased runtime tree with relation nodes fails `RouterImplCheck`. `build()` calls the root `router()` through `rootRouter()`, which uses runtime guards and no casts. Revisited in step 9.
- A self `many()` (`users.friends`) is refused: `<parent>Id` and `<target>Id` would collide. It needs a naming rule later.
- Apps with relations need the `Many` and `RelationsOf` types exported, or declaration emit fails with TS2883.
- After 8b: core type-check 2.10 s (1.97 s without many.test.ts), crm 0.49 s, store-mongo 0.37 s. Asserted overloads: 8 (`relationsOf`).
- ts-pf 0.6.0 still reads a node that may be a procedure or a router as a procedure (`IsContractProcedure` distributes), so `rootRouter()` stays, with a comment. The ts-pf fix, deciding each node by the implementation's node, is in `architecture.md`'s proposed changes table for the maintainer.
- `ReadUseCase` is an exported interface only because `@ts-pf/contract` does not export `ExpandResult`, so a `.d.ts` cannot name a populating read (TS2883). Exporting it from ts-pf would let Lattice drop the interface.
- `many()` without `fields` inferred its type parameters from the `relations` constraint, so the Link type got an index signature. `NoInfer` on its return type fixes it, with a regression test.
- After step 9: core type-check 2.41 s (1.49M instantiations, mostly tests), crm 0.51 s, store-mongo 0.51 s. Asserted overloads: 8.
- examples/crm is tenanted by organization, refs companies with restrict, and runs on MongoStore (start → migrate → ensure). Its app, handler and tenancy tests run on MemoryStore and MongoStore: 50 tests. An archived deal still blocks deleting its company, because restrict counts every row. crm type-check: 0.55 s with tests, 0.44 s sources only.
- Type-check after access: core check 1.08 s to 1.15 s (with a 500-line test file), crm 0.40 s, unchanged. Asserted overloads: 6.
- Type-check cost of the spike: core +0.14 s check (0.87 to 1.01 s), a crm-sized fixture about +0.09 s. 0003 holds.
