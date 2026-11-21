# Phase 0: kernel, in memory

Phase 0 builds the whole collection model on `MemoryStore`, so the API shape is settled before any Mongo, auth or access work. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] `examples/crm` defines three collections, serves them at `/rpc` with `@ts-pf/server-http`, and its tests pass on `MemoryStore`.
- [ ] A TypeScript client of the generated `contract` gets full types for every operation with no casts and no type annotations at the call site.
- [ ] One operation is replaced with an override and one custom method is added, and both keep the contract's types.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root.

## In scope

`collection()`, `framework()`, `family()`, `build()`, the `Where<T>` type with an in-memory matcher, the `CollectionStore` port, `MemoryStore`, generated CRUD use cases, collection hooks, generated event catalogs, the generated contract and implemented router, errors mapped to ts-pf declared errors, overrides, custom methods, and logging through `@hexok/logger`.

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
| `build.ts` | `framework()`, `.collection(C, { methods, overrides })`, `build()`: use cases, event catalogs, contract, router |
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

- [ ] `Where<T>` keyed by the collection's fields, with `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists`, `contains` (string fields), `and` and `or`. A field the schema does not have is a type error.
- [ ] Runtime validation of a `Where` against the schema: an unknown field is a `VALIDATION` error.
- [ ] `matches(doc, where)` for `MemoryStore`, tested per operator.

### 3. `CollectionStore` and `MemoryStore`

- [ ] The port as the architecture doc shows it, minus `ensure()` and `count()` (Phase 1). `find` takes `where`, `sort`, `limit` and `after` and returns `{ docs, next }`.
- [ ] Cursors are opaque strings that encode the sort values plus `id`. A cursor from a different sort is a `VALIDATION` error.
- [ ] `MemoryStore` stores copies, so a caller mutating a returned document does not change the store.
- [ ] `get`, `update` and `remove` take the optional `where` and honor it, so Phase 1 access filters need no store change.
- [ ] `remove` returns the removed document, or `null` when no row matched.

### 4. `family()`

- [ ] `family({ actor })` returns a hexok `UseCase.context` factory. Its context is `{ actor }`, typed from the actor schema.
- [ ] Guards: the actor parses against its schema; the input parses against the use case's `input` schema. Both throw `LatticeError` codes that map to ts-pf `UNAUTHORIZED` and `VALIDATION`.
- [ ] Hooks: one child logger per call with `collection`, `action`, `actorId` and `durationMs`; `onCatch` logs unexpected errors once.
- [ ] A hand-written use case can extend the same family, as `PublishPost` does in the architecture doc.

### 5. Generated CRUD use cases and hooks

- [ ] `find`, `get`, `create`, `update` and `delete` per collection, as classes in the app's family.
- [ ] `create` sets `id` (`crypto.randomUUID()`), `createdAt` and `updatedAt`; clients cannot set them. `update` is a partial patch and bumps `updatedAt`. A patch never applies schema defaults: Zod 4 `.partial()` still fills them, so a patch of `{ id }` would reset every defaulted field.
- [ ] `delete` returns the deleted document.
- [ ] `get`, `update` and `delete` on a missing id throw `NOT_FOUND`.
- [ ] Hooks run in this order: `beforeValidate`, input validation, `beforeChange`, store write, `afterRead` on every returned document.

### 6. Event catalogs

- [ ] One hexok `EventCatalog` per collection with `<slug>.created`, `<slug>.updated` and `<slug>.deleted`. Payloads are `{ doc, previous?, actorId }`, typed from the schema. (`tenantId` is added in Phase 1.)
- [ ] `framework({ events })` takes a publisher with a `publish(event)` method. The app's existing `DomainEventPublisher` port must fit without an adapter. Tests use an in-memory publisher.
- [ ] Events publish after the store write succeeds, never before.

### 7. Contract, router and errors

- [ ] `build()` returns `contract`, a ts-pf `router` with one slice per collection, and `app`, the implemented router. Each procedure calls one use case.
- [ ] Every procedure declares the same errors: `UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION`. `errors.ts` maps `LatticeError` to them once, the way hexok's `app-template` does in `servers/rpc/errors.ts`.
- [ ] The ts-pf context is `{ actor }`. The app builds it at the edge.

### 8. Overrides and custom methods

- [ ] `.collection(C, { overrides: { action: Class } })` replaces one generated use case. `build({ overrides: { slug: { action } } })` takes the instance.
- [ ] `.collection(C, { methods: { name: Class } })` adds a procedure to the collection's slice. `build({ methods: { slug: { name } } })` takes the instance.
- [ ] Missing instances and type mismatches are compile errors (proved in step 1; now with runtime tests).
- [ ] `build()` also returns `useCases`, `repos` and `events`, as the architecture doc lists.

### 9. `examples/crm`

- [ ] Three collections: `companies`, `contacts` (with a `companyId` string field; `ref()` arrives in Phase 1) and `deals`.
- [ ] One override (`deals.delete` archives instead of deleting) and one custom method (`deals.close`).
- [ ] Served by `FetchHandler` on srvx at `/rpc`, with an actor read from a dev header. Real auth is Phase 2.
- [ ] Tests through `createLocalClient` cover each collection's CRUD, the override, the method, and one event per action.
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
- Step 1: a ts-pf `Implementer` has its own keys (`$context`, `use`, `useAfter`, `middleware`, `router`), so a slug or method with one of those names would shadow them. They are reserved. Went to `architecture.md`.

- None yet.
