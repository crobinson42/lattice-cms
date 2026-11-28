# Phase 4: Hardening for the first products

Phase 4 closes the gaps that StaffDuty (a tenanted service desk with one actor kind) and DutyHire (a two-sided marketplace with several party kinds) found when they adopted Lattice 0.2.0. It starts with what both apps hit, and each step ships as its own release. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] Each step below is released to npm, and its records are accepted or withdrawn.
- [ ] `examples/crm` uses each feature that a CRM would use: transactions, conditional writes, sequences and the outbox.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root.

## In scope

The items the maintainer approved on 2026-11-27: access Wheres that fail closed, repos in a transaction, conditional repo writes and an insert with a given id, a tenancy map with `tenancy.none`, an operations list on `.collection()`, server-owned fields and sequences, and the outbox. Also the docs the apps asked for: mounting beside other routers, and an anonymous read recipe.

## Out of scope

Versions and drafts, Postgres, uploads, index and performance tooling, and the security review, until a product needs them. Row-aware field masking: [0031](../decisions/0031-masked-fields-are-withheld-at-the-client-boundary.md)'s revisit condition holds for DutyHire, but the maintainer has not asked for it. Do not add options for them.

## Compatibility

Apps now depend on published releases, so [0017](../decisions/0017-breaking-changes-are-free-before-1-0.md)'s revisit condition holds. A breaking change ships as a minor release, and its changeset starts with **Breaking** and says how to migrate. No shims.

## Steps

Each step ends with its tests passing, an independent review, a changeset and a release. Tick it here when it does. The maintainer chose the designs of steps 4 and 6 on 2026-11-27; step 7's details need a checkpoint.

### 1. Access Wheres fail closed

- [x] `CallAccess.scope()` checks every access `Where` against the collection's output before a store sees it. An undefined operand, a field with no operator, an unknown field or operator, or a bad operand throws a plain `Error` that names the path. An empty `or` is allowed. `tenancy.scope` refuses an empty or missing tenant. A bug fix for 0005: no record.

### 2. Repos in a transaction

- [x] `transaction(async (repos) => …)` beside `repos` in the methods and overrides factories, and on `build()`. It runs `CollectionStore.transaction` and hands the work repos bound to the transaction's store. Repos publish no events, so the app publishes after the commit. Record: [0040](../decisions/0040-repos-join-a-transaction-through-transaction.md).
- [x] In the overrides factory, `work` also receives `generated`, bound to the transaction, with its events held until the commit. StaffDuty's update override writes audit rows beside the generated update.

### 3. Conditional writes and a given id

- [x] `repo.update(id, patch, scope, { if })` and `repo.remove(id, scope, { if })`: the `if` Where is ANDed with the scope, and a failed condition returns null, like a missing row.
- [x] `repo.insert(data, scope, { id })`: server code inserts with its own id, such as a projection that shares its source's id. An existing id is `CONFLICT`. Generated create keeps server UUIDs.
- [x] Record: repo writes take a condition and an id ([0041](../decisions/0041-repo-writes-take-a-condition-and-an-id.md)).

### 3a. Unique indexes

- [x] `CONFLICT` data gains `fields`: the clashing unique index's fields as declared, or `['id']`. MemoryStore names the failed index, and MongoStore reads `keyPattern`. The generic message no longer says "id".
- [x] MemoryStore keys an array field per element, as MongoDB's multikey index does, with conformance cases: `['a','b']` and `['b','c']` clash.
- [x] Record: [0042](../decisions/0042-conflict-names-the-clashing-fields.md).
- [x] MemoryStore hands `work` a store of its own and runs transactions one at a time. A rollback undoes only that store's writes and indexes. A `CONFLICT` inside a transaction aborts it, as on MongoDB. An index refuses two array fields. Conformance cases for each that MongoDB shares.
- [x] `Index` gains `present: [field]` on a unique index: the index covers only rows where each field has a value, and an array has an element that is neither null nor an array. MongoStore maps it to a `partialFilterExpression` of `$type`s, so no schema kinds are needed. Conformance cases. Record: [0043](../decisions/0043-a-unique-index-can-skip-rows-without-a-value.md).
- [x] A unique index on a tenanted collection must include the tenant field: a compile error and a throw. A client's `CONFLICT` leaves the tenant field out. Records: [0044](../decisions/0044-a-tenanted-unique-index-includes-the-tenant-field.md), [0045](../decisions/0045-lattice-errors-are-final-at-the-client-boundary.md).
- [x] `build().clientError(error)` and the `latticeErrors` export, so an app's own router sends Lattice's errors as the procedures do. The crm's `/auth` router and edges use them.
- [x] `ensure()` over an index that differs from the declared one throws an error that names the existing index and says to drop it in a migration. The READMEs say migrations run before `ensure()`.

### 4. Tenancy by field, and no tenant

- [ ] `family({ tenantOf })` becomes a map keyed by tenant field: `{ organizationId: (a) => …, professionalId: (a) => … }`. Each returns an id, `tenancy.bypass` or `tenancy.none`. `none` makes that collection `FORBIDDEN` for the actor. A collection whose tenant field has no entry is a compile error and a runtime throw. The tenant cache is per field. Breaking.
- [ ] Record superseding [0024](../decisions/0024-tenant-bypass-is-decided-by-tenant-of.md).
- [ ] The anonymous read recipe, in the core README: an anonymous actor, `tenancy.none` on tenanted collections, and `read` access on public ones.

### 5. An operations list

- [ ] `.collection(C, { operations: ['find', 'get'] })` exposes only the listed generated operations in the contract, OpenAPI, MCP and the admin. The `access` keys narrow to the listed actions and the methods. Record: an amendment beside [0021](../decisions/0021-access-attaches-at-composition.md).

### 6. Server-owned fields and sequences

- [ ] A marker for a field that the server writes: it is in output, `Where`, `Sort` and repo writes, and never in create or update input.
- [ ] `CollectionStore.next(sequence, scope)`: MongoStore increments a counter document with `findOneAndUpdate`, and MemoryStore keeps a map. The conformance suite covers it. Record.

### 7. The outbox **Checkpoint**

- [ ] Events are written to an outbox collection in the same store transaction as the write, and a relay in `@latticecms/store-mongo` publishes each one with a stable id. Record, and the delivery gap section of `architecture.md` changes.

### 8. Docs

- [ ] Core README: "Mounting beside other routers". `build().app` requires an actor, so it cannot nest under an actor-less router without a cast. ts-pf answers 404 once a prefix matches, so mount on distinct prefixes, most specific first, as `examples/crm/src/servers/http/handler.ts` does.

## Backlog

Recorded, not scheduled:

- The CLI in a split monorepo: config paths that point at sibling workspace packages, so `lattice collection` can scaffold when collections and composition live in different packages.
- A definition-time error when a slug collides with a reserved top-level router key.
- An upsert on repos, if insert-then-update on `CONFLICT` proves awkward. Inside a MongoDB transaction, insert-then-update does not work: a duplicate key aborts the transaction.
- A `prepare(data)` that parses, applies defaults and runs `beforeChange` without writing. Declined for now: seeding through the generated create covers StaffDuty. Reconsider when a second app needs a hooked document with no generated operation.

## Discoveries

- The walkthrough packed every package as 0.1.0, which broke once the internal peer ranges moved. It now packs each package at its own version.
- `{ field: {} }` passed the first access check. It is what `{ eq: undefined }` becomes after JSON, as from a remote policy service, and `MemoryStore` matched every row with it. A field in a code-built `Where` now needs an operator.
- A `transaction` called inside another's `work` starts a separate transaction. On MongoDB its writes commit on their own, and MemoryStore joined it only through a store-wide flag. 0040 says it does not nest: inner code takes the repos `work` received.
- `MemoryStore` let a transaction that started during another join it, so the first one's rollback dropped the second's writes. It now runs them one at a time.
- Inside a MongoDB transaction, a caught `CONFLICT` makes the driver run `work` again for about 120 seconds, its retry limit. `MemoryStore` throws at once.
- A unique index keys a missing field as null and an empty array as one value, so two rows without a value clash on MongoDB. And `MemoryStore` compared an array key whole, where MongoDB compares each element.
- `MemoryStore` joined any call made in `work`'s async context, so a timer that fired after the commit joined a finished transaction, and a root-store call inside `work` joined where MongoDB's would not. `work` now gets its own store, as a MongoDB session binds calls. Async context remains only to let a root `transaction` inside `work` run beside the outer one instead of deadlocking.
- MongoDB refuses an index over two array fields in one document, even empty ones (code 171). `MemoryStore` accepted it.
- A partial filter cannot say `$ne: null`, but a `$type` list of every type except null, undefined and array can. On an array, `$type` matches by element, so `[]`, `[null]` and `[[1]]` are left out. A row a partial index leaves out is not checked for parallel arrays.
- A declared index stood in for a ref's lookup index when its keys led with the ref. A partial one cannot: MongoDB 8.0 collection-scans `{ ref: id }` beside a `$type` partial index. With the same keys, MongoDB refuses the plain lookup index (code 86), so that lookup index adds `id`.
- MongoDB compares partial filters as documents, ignoring field order, so `present: ['a','b']` and `['b','a']` are the same index.
- `CollectionIndex`'s tenant check needs `NoInfer<Tenant>`, or TypeScript infers the tenant from a unique index's keys.
- `.collection()` lost `R` when an access function was a generic helper's call, such as an app's `allow<W>(...)`, beside a method. Each method read as having no access function, and a plain arrow beside it lost its `actor` type. The method check now reads `access`'s keys from a separate type parameter.
