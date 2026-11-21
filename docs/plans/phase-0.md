# Phase 0: kernel, in memory

Phase 0 builds the whole collection model on `MemoryStore`, so the API shape is settled before any Mongo, auth or access work. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] `examples/crm` defines three collections, serves them at `/rpc` with `@ts-pf/server-http`, and its tests pass on `MemoryStore`.
- [ ] A TypeScript client of the generated `contract` gets full types for every operation with no casts and no type annotations at the call site.
- [x] One operation is replaced with an override and one custom method is added, and both keep the contract's types.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root.

## In scope

`collection()`, `framework()`, `family()`, `build()`, the `Where<T>` type with an in-memory matcher, the `CollectionStore` port, `MemoryStore`, generated CRUD use cases, collection hooks, generated event classes, the generated contract and implemented router, errors mapped to ts-pf declared errors, overrides, custom methods, and logging through `@hexok/logger`.

## Out of scope

`ref()`, `many()`, population, `onDelete`, the `Access` port, tenancy, `withTotal`, indexes, migrations, Mongo, Redis, MCP, OpenAPI, tracing, the admin and the CLI. Do not add options for them. Leave room for them: they are Phase 1 and 2, and the architecture doc shows where each one attaches.

## Files

`packages/core/src/`, one concern per file:

| File | Holds |
| --- | --- |
| `collection.ts` | `collection()`, system fields (`id`, `createdAt`, `updatedAt`), `.hooks()` |
| `where.ts` | `Where<T>` and `matches(doc, where)` for `MemoryStore` |
| `store.ts` | the `CollectionStore` port and `MemoryStore` |
| `family.ts` | `family()` on hexok `UseCase.context`: actor guard, input guard, logging hooks |
| `errors.ts` | the `LatticeError` hexok `Errors` catalog and its mapping to ts-pf declared errors |
| `build.ts` | `framework()`, `.collection(C, { methods, overrides })`, `build()`: use cases, contract, router |
| `index.ts` | the public exports |

Add a file only when one of these grows a second concern. Tests sit next to the file they cover.

## Steps

Each step ends with its tests passing. Tick it in this file when it does.

### 1. Type spike **Checkpoint**

The risk in Phase 0 is types, not runtime. Prove the type flow before building the runtime.

- [x] In a test file, write the smallest `collection()` and `build()` that type-check end to end: a Zod schema → `collection('posts', { schema })` → `framework({ family }).collection(Posts).build()` → `contract` → `createLocalClient(app)` → `await local.posts.get({ id })` returns the post type with system fields.
- [x] Show that `overrides: { delete: X }` is a type error when `X` takes or returns the wrong types, and that `build()` is a type error when a declared method or override has no instance.
- [x] Bodies may `throw new Error('todo')`. Only the types matter here.

Stop and show the maintainer the spike: the public type signatures and one sample call site. Continue when they approve the shape.

### 2. `Where<T>` and the matcher

- [x] `Where<T>` keyed by the collection's fields, with `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists`, `contains` (string fields), `and` and `or`. A field the schema does not have is a type error.
- [x] Runtime validation of a `Where` against the schema: an unknown field is a `VALIDATION` error.
- [x] `matches(doc, where)` for `MemoryStore`, tested per operator.

### 3. `CollectionStore` and `MemoryStore`

- [x] The port as the architecture doc shows it, minus `ensure()` and `count()` (Phase 1). `find` takes `where`, `sort`, `limit` and `after` and returns `{ docs, next }`.
- [x] Cursors are opaque strings that encode the sort values plus `id`. A cursor from a different sort is a `VALIDATION` error.
- [x] `MemoryStore` stores copies, so a caller mutating a returned document does not change the store.
- [x] `get`, `update` and `remove` take the optional `where` and honor it, so Phase 1 access filters need no store change.
- [x] `remove` returns the removed document, or `null` when no row matched.

### 4. `family()`

- [x] `family({ actor })` returns a hexok `UseCase.context` factory. Its context is `{ actor, logger }`: the actor typed from the actor schema, the logger a `@hexok/logger` `Logger`.
- [x] Guards: the actor parses against its schema; the input parses against the use case's `input` schema. Both throw `LatticeError` codes that map to ts-pf `UNAUTHORIZED` and `VALIDATION`.
- [x] Hooks: one child of `ctx.logger` per call with `collection`, `action`, `actorId` and `durationMs`; `onCatch` logs unexpected errors once.
- [x] A hand-written use case can extend the same family, as `PublishPost` does in the architecture doc.

### 5. Generated CRUD use cases and hooks

- [x] `find`, `get`, `create`, `update` and `delete` per collection, as classes in the app's family.
- [x] `create` sets `id` (`crypto.randomUUID()`), `createdAt` and `updatedAt`; clients cannot set them. `update` is a partial patch and bumps `updatedAt`. A patch never applies schema defaults: Zod 4 `.partial()` still fills them, so a patch of `{ id }` would reset every defaulted field.
- [x] `delete` returns the deleted document.
- [x] `find` applies `defaultSort` and `defaultLimit` (`sort.ts`) when the caller gives none, and validates `where` and `sort` before the store sees them.
- [x] `get`, `update` and `delete` on a missing id throw `NOT_FOUND`.
- [x] Hooks run in this order: input validation, `beforeChange`, store write, `afterRead` on every returned document. There is no `beforeValidate` ([0019](../decisions/0019-hooks-are-before-change-and-after-read.md)).

### 6. Events

- [x] `collection()` derives `Posts.events.created`, `.updated` and `.deleted`: hexok `Event` classes with tokens `<slug>.created` and so on. Payloads are `{ doc, previous?, actorId }`, typed from the schema. (`tenantId` is added in Phase 1.)
- [x] A test app lists them in its own `EventCatalog` next to a hand-written event, as `architecture.md` shows.
- [x] `framework({ events })` takes a publisher with a `publish(event)` method. An app-template-style `DomainEventPublisher` over that catalog fits unchanged, and `.collection()` is a compile error when the publisher cannot take a collection's events. Tests use an in-memory publisher that checks events against the app catalog, as app-template's queue adapter does.
- [x] Events publish after the store write succeeds, never before.

### 7. Contract, router and errors

- [x] `build()` returns `contract`, a ts-pf `router` with one slice per collection, and `app`, the implemented router. Each procedure calls one use case.
- [x] Every procedure declares the same errors: `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION`, plus the app's `framework({ errors: { declared, map } })`. `errors.ts` maps `LatticeError` to them once, the way hexok's `app-template` does in `servers/rpc/errors.ts`, then applies the app's `map`.
- [x] One function decides whether a thrown value is an expected refusal. `family()`'s `onCatch` logging and the ts-pf mapping both use it, so a code that maps to a declared error is never logged as a failure. Decide whether hexok `CodedError` (e.g. `validationError`, `Entity.parse`) counts; app-template's input guard throws one.
- [x] The edge logs what the family cannot: guard rejections (`UNAUTHORIZED`, `VALIDATION`) and ts-pf's own input rejections, without logging a refusal twice.
- [x] A `VALIDATION` from ts-pf's own input check and one from `LatticeError` reach the client with the same `{ path, message }[]` issue shape.
- [x] The ts-pf context is `{ actor, logger }`. The app builds it at the edge.

### 8. Overrides and custom methods

- [x] `.collection(C, { overrides: { action: Class } })` replaces one generated use case. `build({ overrides: { slug: { action } } })` takes the instance.
- [x] `.collection(C, { methods: { name: Class } })` adds a procedure to the collection's slice. `build({ methods: { slug: { name } } })` takes the instance.
- [x] Missing instances and type mismatches are compile errors (proved in step 1; now with runtime tests).
- [x] `build()` also returns `useCases` and `repos`, as the architecture doc lists.

### 9. `examples/crm`

- [ ] Three collections: `companies`, `contacts` (with a `companyId` string field; `ref()` arrives in Phase 1) and `deals`.
- [ ] One override (`deals.delete` archives instead of deleting) and one custom method (`deals.close`).
- [ ] Served by `FetchHandler` on srvx at `/rpc`, with an actor read from a dev header. Real auth is Phase 2.
- [ ] Tests through `createLocalClient` cover each collection's CRUD, the override, the method, and one event per action.
- [ ] Measure the consumer's emitted declarations. Step 6 found each collection event class inlined into a consumer's catalog `.d.ts` (about 2.3k lines for 7 events). If named exported types let declarations reference the classes instead, use them.
- [ ] Its app module exports the collections, the family, `lattice` and `contract`, and its type-check runs with `declaration: true`. That is the check that every type a consumer's declarations name is exported from `@latticecms/core` (TS2883 fires only outside the package).

### 10. Docs

- [ ] `packages/core/README.md` states what the package does, requires and guarantees, with one example from `examples/crm`.
- [ ] `docs/architecture.md` matches what was built. Record any difference and why.
- [ ] A changeset for `@latticecms/core`.

## Discoveries

Add a line here when the work teaches something the plan did not know: a type limit, a hexok or ts-pf behavior, a step that should change. Each line says what was found and where it went (a plan change, a `proposed` record, an `architecture.md` edit, or nowhere yet).

- Step 1: a collection that names its method class, while the class names the collection, fails TS7022/TS2506 and the ESM load. Methods and overrides moved to `framework().collection()`. Went to [0018](../decisions/0018-methods-and-overrides-attach-in-the-framework.md), `architecture.md` and steps 1 and 8.
- Step 1: ts-pf over HTTP is plain JSON, so system timestamps are ISO strings. Went to `architecture.md`.
- Step 1: a loose or strict Zod object adds an index signature to client types. Collection schemas are `z.object()` only. Went to `architecture.md`.
- Step 1: the maintainer chose that `delete` returns the deleted document, so `CollectionStore.remove()` returns `Doc | null`. Went to `architecture.md` and steps 3 and 5.
- Step 1: Zod 4 `.partial()` applies defaults (a patch of `{ id }` parsed to `{ status: 'draft', id }`). Went to step 5.
- Step 1: type-check of the spike is 0.70 s and 189k instantiations for two collections. Re-measure at step 9.
- Step 1: TS2883 (a type that cannot be named) only fires for a consumer outside `packages/core`; inside, TypeScript names types by relative path. The public types are `Collection`, `Framework`, `Contract`, `Family` and `FamilyContext` because a consumer's declarations need them. Went to step 9.
- Step 1: hexok's `#brand` is a structural key in declarations, so `build()` tells instances of two use cases with the same `execute` types apart only by private members. `build()` also checks `instanceof` the declared class at runtime. Nowhere else yet.
- Step 8: six asserted overloads now sit where runtime-built values meet precise types (`build`, `whereSchema`, `sortSchema`, `patchSchema`, `repo`, `Framework.repo`). Each is commented; no value is cast. Typing `CollectionStore` per collection would remove the two repo ones. Nowhere yet; watch the count.
- Step 8: `Repo.update` takes `Partial<Data>`, so under `exactOptionalPropertyTypes` it cannot unset an optional field, though the store can. Nowhere yet.
- Step 8: generated `useCases` members take the schema's input type (defaults optional), while the contract follows ts-pf's output typing until the ts-pf fix lands.
- Step 7: ts-pf reserves `VALIDATION`, `INTERNAL`, `BAD_REQUEST`, `METHOD_NOT_ALLOWED` and `PAYLOAD_TOO_LARGE`; Lattice declares four codes and sends `VALIDATION` as the protocol code. In-process callers get unknown errors raw; only the wire makes `INTERNAL`. Went to `architecture.md`.
- Step 7: refusal logging is once per refusal: the family's `onCatch` records what it logged in a `WeakSet`, and Lattice's router middleware logs the rest (guard and ts-pf input rejections). A guard rejection reached by calling `execute` directly is logged by nobody. Went to step 8.
- Step 7: overrides and methods throw the app's domain errors, which Lattice's five codes cannot carry. `framework({ errors: { declared, map } })` takes the app's existing error map and mapper. Maintainer's choice. Went to `architecture.md` and step 7.
- Step 6: hexok `Event` classes are invariant in their payload, so `AnyCollection` holds them as `EventCatalog`'s erased constructor, and `crud.ts` checks each payload with `satisfies`. Nowhere else.
- Step 6: `Family` carries `actorId`; `AppUseCase.guard(...)` after `family()` returns a plain hexok factory without it, which `framework()` rejects. Went to `architecture.md`.
- Step 6: app-template's publisher accepts, and at runtime allows, only its own catalog's events, so per-collection catalogs could not fit it. Event classes moved onto the collection, for the app to list in its one catalog. Maintainer's choice. Went to [0020](../decisions/0020-collection-events-join-the-app-catalog.md), `architecture.md` and steps 6 and 8.
- Step 5: Zod 4 `.partial()` and `.exactPartial()` fill `default`/`prefault` even under `.optional()`, and `.partial()` throws on refined objects. The patch schema is rebuilt per field without defaults, using `z.core.util.clone` to rebuild any wrapper. Went to `architecture.md`.
- Step 5: update validates the merged document with the whole schema, so object refinements hold, and dropped keys are removed. Old documents that break the current schema fail update until migrated. Went to `architecture.md`; Phase 1 migrations.
- Step 5: hook types are method signatures so a collection stays assignable to `AnyCollection`. Nowhere else.
- Step 4: `family()` takes `actorId: (actor) => string` for log lines, parallel to Phase 1's `tenantOf`. Went to `architecture.md`.
- Step 4: hexok guards run outside hooks, so family logging cannot see guard rejections. Went to step 7.
- Step 4: the logger lives on the call context (`{ actor, logger }`), not `framework()`: family hooks are fixed at `family()` and see only the call. Maintainer's choice. Went to `architecture.md` and steps 4 and 7.
- Step 4: `beforeValidate` is dropped, because ts-pf validates input at the edge and can only skip that per server. Maintainer's choice. Went to [0019](../decisions/0019-hooks-are-before-change-and-after-read.md) (proposed, supersedes 0012) and step 5.
- **Follow up:** the maintainer is fixing ts-pf's client input typing (below) in a ts-pf session named `ts-pf-lattice-bug`. Before step 9, check with that session for the released version, bump `@ts-pf/*`, and add a test that a defaulted collection field is optional in `create`'s client input.
- Step 3: ts-pf types a procedure's client input as the schema's *output* (`ContractBuilder.input` → `InferSchemaOutput`), so a Zod `.default()` makes the field required for clients. This contradicts ts-pf's own `docs/evolution.md`. `find` applies its defaults in the use case. It also makes every defaulted collection field required in `create`. Taken to the maintainer.
- Step 3: `MongoStore` will need `orderOf`, `after`, `encodeCursor` and the port types. Recommended: a subpath export `@latticecms/core/store`, not the root. Phase 1.
- Step 3: `Sort` cannot forbid a repeated field at the type level; the runtime rejects it, as with an empty `and`. Nowhere else.
- Step 3: the kind analysis now tracks null and undefined on both sides, the base for later required-field rules (tenant fields, unique indexes). Nowhere else.
- Step 2: `Where<Doc>` is a hand-written mapped type for hover readability, so `whereSchema` states its static type in one overload, the second asserted boundary after `build()`. Paired type and runtime tests back it. Nowhere else yet.
- Step 2: `KindOf` (type) and `kindOf` (schema) are two implementations of one rule; a 29-row table test checks both. `z.lazy` is not unwrapped, so a lazy scalar field could disagree. Nowhere yet; revisit if a collection needs `z.lazy`.
- Step 2: Zod brands are type-only, and `z.email()` / `z.iso.datetime()` are not `instanceof` classic `ZodString`; kind detection reads `def.type`. Nowhere else.
- Step 2: ts-pf validates `find` input with the same where schema, so a bad filter over RPC is a ts-pf `VALIDATION` with Zod's object path, until step 7 maps errors. Went to step 7.
- Step 2: type-check is 0.92 s and 311k instantiations, from 0.30 s before Phase 0. Re-measure at step 9.
- Step 2: `collection()` rejects `z.date()` and transforms anywhere in a schema. Went to `architecture.md`.
- Step 1: a ts-pf `Implementer` has its own keys (`$context`, `use`, `useAfter`, `middleware`, `router`), so a slug or method with one of those names would shadow them. They are reserved. Went to `architecture.md`.

- None yet.
