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

### 3. Conditional writes and a given id

- [x] `repo.update(id, patch, scope, { if })` and `repo.remove(id, scope, { if })`: the `if` Where is ANDed with the scope, and a failed condition returns null, like a missing row.
- [x] `repo.insert(data, scope, { id })`: server code inserts with its own id, such as a projection that shares its source's id. An existing id is `CONFLICT`. Generated create keeps server UUIDs.
- [x] Record: repo writes take a condition and an id ([0041](../decisions/0041-repo-writes-take-a-condition-and-an-id.md)).

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
- An upsert on repos, if insert-then-update on `CONFLICT` proves awkward.

## Discoveries

- The walkthrough packed every package as 0.1.0, which broke once the internal peer ranges moved. It now packs each package at its own version.
- `{ field: {} }` passed the first access check. It is what `{ eq: undefined }` becomes after JSON, as from a remote policy service, and `MemoryStore` matched every row with it. A field in a code-built `Where` now needs an operator.
- A `transaction` called inside another's `work` starts a separate transaction. On MongoDB its writes commit on their own, and MemoryStore joined it only through a store-wide flag. 0040 says it does not nest: inner code takes the repos `work` received.
- `MemoryStore` does not isolate concurrent transactions: a rollback undoes writes that other calls made meanwhile. The README says it is for tests and development.
