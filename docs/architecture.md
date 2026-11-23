# Lattice CMS: architecture and build plan

Lattice CMS (`@latticecms/*`) is a separate project that turns a collection definition into ordinary hexok use cases and a ts-pf contract. It adds only what hexok and ts-pf do not have: collections, a query filter, relations, tenancy scoping and (later) an admin UI. Everything else (ports, adapters, events, queues, auth, logging, HTTP, MCP, OpenAPI, clients) comes from the packages the team already maintains.

This file describes the design as it stands now. It changes in place, in the same PR as the code, and keeps no history. Why each major choice was made, and when to revisit it, is in the [decision records](decisions/README.md); sections below link to them by number.

## Where it lives

Lattice is one layer above hexok and ts-pf. Product apps use Lattice for collections, and use hexok and ts-pf directly for anything a collection does not cover, such as overrides, custom methods and workers. Arrows point from a package to what it depends on.

```
                 product app
     (collections, overrides, methods, composition root)
        │                  │                    │
        ▼                  ▼                    ▼
  hexok + @hexok/*  ◄──  @latticecms/*  ──►  @ts-pf/*
  UseCase, Port,         collection(),        contract, server,
  Adapter, Mapper,       Where, relations,    server-http, client,
  EventCatalog, auth,    tenancy, build()     mcp, openapi, codegen,
  queue, logger,                              docs catalog
  webhooks, ...
        │                  │
        ▼                  ▼
      Redis             MongoDB (store-mongo)
```

Nothing points back up. A change to the admin or a field helper releases `@latticecms/*` only; hexok and ts-pf keep their own release cadence.

## Who owns each concern

Lattice owns only the rows marked **Lattice** ([0001](decisions/0001-build-on-hexok-and-ts-pf.md)).

| Concern | Owner | How Lattice uses it |
| --- | --- | --- |
| Entities, use cases, errors | `hexok` (`Entity`, `UseCase`, `Errors`, `Result`) | Generated CRUD operations are `UseCase` classes in the app's `UseCase.context` family |
| Use case lifecycle hooks | `hexok` `UseCase.context().guard().hooks()` | Access, tenancy and input checks are family guards. Tracing and logging use `preExecute` / `onFinally` |
| Storage | **Lattice** `CollectionStore` port, built with hexok `Port` / `Adapter` / `Mapper` | One port for every collection; Mongo and memory adapters |
| Query filter (`Where`) | **Lattice** | A small typed filter that each store translates |
| Relations, join collections | **Lattice** | Ref fields, join collections, batched population |
| Tenancy | **Lattice** collection option, fed by the app's actor | Scopes reads and stamps writes with the tenant field |
| Authentication | `@hexok/auth`, `-redis`, `-jose` | The app builds the actor at the edge. Lattice never imports auth |
| Authorization | **Lattice** `Access` port now; `@hexok/authz` adapter when that package ships | Default: per-collection access functions returning `boolean` or a filter |
| Events | `hexok` `Event` / `EventCatalog` / `EventHandler` + `@hexok/queue` (durable) + `@hexok/broadcast` (at most once) | Each collection carries generated `Event` classes; the app lists them in its own catalog |
| Cross-product events | `@hexok/integration-events` | The app maps a collection event to a versioned contract at the edge |
| Outbound webhooks | `@hexok/webhooks` | An event handler publishes a webhook; no Lattice code |
| Jobs, schedules | `@hexok/queue` + `@hexok/schedule-coordinator` | Scheduled use cases, as in hexok's `app-template` |
| Logger, error capture | `@hexok/logger`, `-sentry`, `-newrelic` | On the call context: `ctx.logger`, built at the edge |
| Tracing | `@opentelemetry/api`, called directly (Phase 2) | ts-pf call interceptors + use case hooks |
| Custom methods | `hexok` `UseCase` | `.collection(Posts, { methods: { publish: PublishPost } })` adds it to the collection's router slice |
| HTTP | `@ts-pf/server-http` `FetchHandler` | Mount on srvx, Hono, Bun, Next or Astro |
| In-process calls | `@ts-pf/server` `createLocalClient`, or calling use cases directly | Same middleware and errors as HTTP |
| GraphQL | Not planned | ts-pf is RPC; OpenAPI covers outside callers |
| MCP tools | `@ts-pf/mcp` | Every collection becomes MCP tools |
| OpenAPI, other languages | `@ts-pf/openapi`, `@ts-pf/codegen` | Codegen profile for non-TypeScript clients |
| Typed clients | `@ts-pf/client` + `client-http`, `@ts-pf/swr`, `@ts-pf/mvc-kit` | Web and admin clients use the same contract |
| File uploads | `@ts-pf/file` (multipart) + a blob storage port (missing) | Phase 3 |
| Admin UI | **Lattice** `admin` package, reading `@ts-pf/docs` `catalog()` + procedure `.meta()` | Phase 3 |
| CLI | **Lattice** `cli` | Scaffolding and migrations only, Phase 3 |

## Core model: a collection compiles into hexok and ts-pf

A collection is a declaration. Lattice turns it into hexok use cases, hexok event classes and a ts-pf router slice ([0003](decisions/0003-collections-compile-at-runtime.md)). Nothing runs outside those primitives, so every generated piece can be replaced by a hand-written one with the same types.

### Define a collection

This example shows the design as built, except `entity`, which is not built yet. [`packages/core/README.md`](../packages/core/README.md) shows what runs today.

```ts
// collections/posts.ts
import { collection, ref, many } from '@latticecms/core'
import { z } from 'zod'

export const Posts = collection('posts', {
  schema: z.object({
    title: z.string().min(1),
    body: z.string(),
    status: z.enum(['draft', 'published']),
    authorId: ref('users'),
  }),
  tenant: 'organizationId',
  relations: {
    categories: many('categories', {
      through: 'post_categories',
      fields: z.object({ sortOrder: z.number().int(), isPrimary: z.boolean() }),
    }),
  },
  indexes: [{ fields: { status: 1, createdAt: -1 } }],
})
  .hooks({ beforeChange: ({ data }) => ({ ...data, title: data.title.trim() }) })
```

- `schema` is a Zod 4 object ([0013](decisions/0013-zod-4-for-collection-schemas.md)). Lattice adds `id`, `createdAt`, `updatedAt` and the tenant field.
- (Not built yet; unscheduled) A collection may pass `entity: Post` instead of `schema`, where `Post extends Entity('Post', schema)`. Then domain rules live on the entity, the hexok way.
- `ref()` and `many()` are the only field helpers. Everything else is plain Zod.
- Only `z.object()`. Unknown keys are stripped. A loose object's index signature would reach every client type.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names.
- No `z.date()` and no transforms (`.transform()`, `.pipe()`, `z.preprocess`, codecs), anywhere in the schema. A Date reaches an HTTP client as a string, and a transform hides the field's kind from `Where`. Normalizing belongs in a `beforeChange` hook. `collection()` throws at definition time and, for top-level Dates, fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings, not `Date`. ts-pf sends JSON, so a `Date` would reach an HTTP client as a string while its type said `Date`.
- A collection names no use case classes and no access rules. Methods, overrides and access attach where the app composes ([0018](decisions/0018-methods-and-overrides-attach-in-the-framework.md), [0021](decisions/0021-access-attaches-at-composition.md)).

### Compose and build

```ts
// app/use-cases/context.ts: the app's one use case family
export const AppUseCase = family({
  actor: actorSchema,                        // the app's actor, built by @hexok/auth at the edge
  actorId: (actor) => actor.userId,          // the id log lines carry
  tenantOf: (actor) => (actor.support ? tenancy.bypass : actor.organizationId), // the call's tenant (0024)
})

// servers/rpc/contract.ts: the definition. No ports, so clients and codegen can import it.
export const lattice = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError }, // the app's servers/rpc/errors.ts
})
  .collection(Users)
  .collection(Posts, {
    methods: { publish: PublishPost },
    overrides: { delete: ArchivePost },
    access: {
      read: () => true,
      update: ({ actor }) => ({ authorId: { eq: actor.userId } }), // a Where on Posts
      delete: ({ actor }) => actor.roles.includes('admin'),
      publish: ({ actor }) => actor.roles.includes('editor'),      // a method's own action
    },
  })
  .collection(Categories)

export const contract = lattice.contract

// servers/app.ts: the wiring
const { app, useCases, repos, onError } = lattice.build({
  store,                         // a started CollectionStore: new MongoStore({ url, database }), then await store.start()
  events: domainEvents,          // hexok Port over @hexok/queue
  methods: ({ repos }) => ({ posts: { publish: new PublishPost({ posts: repos.posts, email }) } }),
  overrides: ({ repos }) => ({ posts: { delete: new ArchivePost({ posts: repos.posts }) } }),
})
```

- The definition (`framework({ family, errors })` and `.collection()`) gives `contract` with no store and no publisher. The wiring (`build({ store, events, access?, methods, overrides })`) needs both ([0018](decisions/0018-methods-and-overrides-attach-in-the-framework.md), [0020](decisions/0020-collection-events-join-the-app-catalog.md)).
- `.collection(C, { access, fields, methods, overrides })` declares the access functions, the field rules and the classes. `access` is required ([0021](decisions/0021-access-attaches-at-composition.md)), and `fields` is required exactly when `C` has maskable fields. The classes' static schemas type the contract, so the definition module imports the use case classes; they load with no ports or I/O, and a browser client imports the contract with `import type`.
- `build()` takes one factory each for methods and overrides. Each receives the typed `repos` and returns one instance per declared class, keyed by slug and then name, the same shape as the contract. Each is required exactly when a collection declared one.
- A `Repo<C>` has `get(id, scope)`, `getMany(ids, scope)`, `find({ where?, sort?, limit?, after? }, scope)`, `count(where, scope)`, `insert(data, scope)`, `update(id, patch, scope)` and `remove(id, scope)`, typed from `C`. It stamps `id`, `createdAt` and `updatedAt` like the generated operations, and runs no hooks, events or access: it is trusted, like a hexok repository. `insert` takes the schema's input type and parses it as `create` does, so defaults apply and a bad document is `VALIDATION`. `update` writes its typed patch as given, without re-validating the merged document as the generated update does.
- The scope is required: the call's `Scope<C['slug']>` from `ctx.access.scope(C, action)`, `tenancy.scope(C, tenantId)` for server code inside one tenant, or `unscoped` for trusted code that acts for no caller. A row outside the scope acts as missing, and a scope for another collection throws ([0023](decisions/0023-access-reaches-use-cases-through-the-call-context.md)). On a tenanted collection, `insert` stamps the scope's tenant and does not take `unscoped`, and `update` never writes the tenant field ([0024](decisions/0024-tenant-bypass-is-decided-by-tenant-of.md)).

| Output | What it is | Used by |
| --- | --- | --- |
| `contract` (on the definition) | A ts-pf `router` of every collection | Clients, `@ts-pf/openapi`, `@ts-pf/codegen`, the admin |
| `app` (from `build()`) | The implemented ts-pf router | `FetchHandler`, `createLocalClient`, `@ts-pf/mcp` |
| `useCases` | hexok `UseCase` instances, such as `useCases.posts.create`: the generated one, or the override or method instance that serves the procedure, each precisely typed | Workers, scripts, tests |
| `repos` | `Repo<C>` per collection, the same objects the factories received | Hand-written use cases and event handlers |
| `onError` | `onError(logger)` for `FetchHandler` | The HTTP edge |
| `ensure` | `ensure()`: creates each collection's declared indexes through the store. Await it after `store.start()`, before serving | The app's startup |
| `context` | `context({ actor, logger })`: a `FamilyContext` with the call's `access`. Make one per call or per job | Direct `useCases.*.execute` callers |

### What each collection generates

Every write returns the document: `create` and `update` the stored one, `delete` the one it removed.

- `create` sets `id` (a UUID), `createdAt` and `updatedAt`. Clients cannot set them.
- `update` is a partial patch. A patch never applies schema defaults, so an omitted field keeps its stored value. The merged document is validated with the whole schema, so an object-level `.refine()` holds on update as on create, and a stored key the schema no longer has is removed. Only changed fields and `updatedAt` are written. A stored document that no longer fits the schema fails `update` until a migration fixes it.
- `get`, `update` and `delete` on a missing or out-of-scope id throw `NOT_FOUND`.
- Each generated use case parses its own input, because hexok passes `execute` the raw value. The family guard has already rejected bad input.

- Use cases, in the app's one family: `posts.find`, `posts.count`, `posts.get`, `posts.create`, `posts.update`, `posts.delete`, plus `posts.categories.list` and `posts.categories.set` for each `many()` relation.
- A contract slice: `posts.find`, `posts.count`, `posts.get`, `posts.create`, `posts.update`, `posts.delete`, `posts.publish`, and `posts.categories.*`.
- Event classes: `posts.created`, `posts.updated`, `posts.deleted`, for the app's catalog.

### Custom methods and overrides

A custom method is a normal hexok use case in the app's one family ([0007](decisions/0007-one-use-case-family-per-app.md)). `family()` builds that family on hexok `UseCase.context`, so generated, overridden and custom use cases share one context type and one guard chain:

```ts
export class PublishPost extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  constructor(private readonly deps: { posts: Repo<typeof Posts>; email: EmailSender }) { super() }
  async execute(ctx: UseCase.Ctx<typeof AppUseCase>, input: { id: string }): Promise<Doc<typeof Posts>> {
    const scope = await ctx.access.scope(Posts, 'publish') // the guard has already refused `false`
    const post = await this.deps.posts.get(input.id, scope)
    if (post === null) throw LatticeError.NOT_FOUND({ collection: Posts.slug, id: input.id })
    /* change, save with the same scope, publish an event */
  }
}
```

- The family guards check the actor, validate input, check access for the action (`publish`), and refuse a `where` or `sort` on a withheld field, before `execute`. A guard cannot hand `execute` a value, so `execute` asks `ctx.access` for its scope; the answer is kept on the context, so access runs once per call. The scope also carries the tenant clause.
- The class's `collection` static and its token (`posts.publish`) must match where it is attached. `execute` must take the class's `input` schema output and return its `output` schema output.
- The app constructs the instance in `build()`'s `methods` or `overrides` factory, as hexok requires, with the typed `repos` it receives. `build()` is a type error when a declared method or override has no instance or an instance of another class, the same completeness check as ts-pf `impl.router()`, and it checks `instanceof` at runtime.
- `overrides: { delete: ArchivePost }` swaps one generated operation. The class must accept and return the generated operation's types, so clients see no change.
- Slugs and method names cannot be ts-pf implementer keys (`$context`, `use`, `useAfter`, `middleware`, `router`), and a method cannot reuse a generated operation's name.
- A method publishes its own events from the app's catalog. Generated event classes cover CRUD only.

### Hooks

Collection hooks transform data and nothing else: `beforeChange` and `afterRead` ([0019](decisions/0019-hooks-are-before-change-and-after-read.md)). They run inside the generated use cases, in this order: validate input (on update: read, merge, validate the merged document), `beforeChange`, store write, `afterRead` on every returned document. `beforeChange` receives `{ data, operation, previous? }`, where `data` is the whole document after the change on create and update alike. There is no `beforeValidate`: ts-pf validates input at the edge before any Lattice code runs. Business rules belong in an entity method or an override. Side-effects after a change are event handlers. Cross-cutting behavior (tracing, logging, timing) and error handling use the family's hexok `hooks()` and `onCatch`.

## Storage

Every collection talks to one hexok port, `CollectionStore`. MongoDB is the default adapter ([0002](decisions/0002-mongodb-is-the-default-store.md)). One `build({ store })` serves every collection today. A per-collection store, so one app can keep collections on different clusters or regions, is not built yet.

```ts
abstract class CollectionStore extends Port('CollectionStore') {
  abstract ensure(collection: string, indexes: readonly Index[]): Promise<void> // creates missing indexes, never drops one
  abstract find(q: FindQuery): Promise<Page>                                     // { docs, next }; where, sort, limit, after
  abstract get(collection: string, id: string, where?: AnyWhere): Promise<StoredDoc | null>
  abstract getMany(collection: string, ids: readonly string[], where?: AnyWhere): Promise<StoredDoc[]>
  abstract insert(collection: string, doc: StoredDoc): Promise<void>            // CONFLICT on an existing id or a unique index
  abstract update(collection: string, id: string, patch: Patch, where?: AnyWhere): Promise<StoredDoc | null> // CONFLICT on a unique index
  abstract remove(collection: string, id: string, where?: AnyWhere): Promise<StoredDoc | null>
  abstract count(collection: string, where?: AnyWhere): Promise<number>
  abstract transaction<T>(work: (store: CollectionStore) => Promise<T>): Promise<T> // as atomic as the store can be
}

type Index = { fields: Record<string, 1 | -1>; unique?: boolean } // key order is the index's order
```

- `where` on `get`, `update` and `remove` carries the access and tenant filter, so a write never touches a row the caller cannot see.
- `getMany` exists for relation population. It is one query per collection per request.
- Adapters use a hexok `Mapper` when the stored shape differs. `MongoStore` maps `id` to a string `_id`.
- A collection declares `indexes: [{ fields: { stage: 1, createdAt: -1 }, unique? }]`. Fields are the stored document's, including the system and tenant fields, and an unknown one is a compile error. `build().ensure()` passes them to `store.ensure()`. A tenanted collection's indexes usually lead with the tenant field; Lattice does not add it.
- Field names cannot contain `.`, start with `$`, or be `_id`. Mongo would read them as paths, operators or the id. `collection()` rejects them at compile time and at runtime.

### MongoStore

`@latticecms/store-mongo` is the default adapter. It owns its `MongoClient` ([0025](decisions/0025-mongo-store-owns-its-client.md)):

```ts
const store = new MongoStore({ url: env.MONGODB_URL, database: 'crm', client?: MongoClientOptions })
await store.start() // connects and pings; a second start() joins a pending one
// … serve …
await store.stop()  // closes the client
```

- A call before `start()`, during it, or after `stop()` rejects with `MongoStoreError` (`NotStarted`, `Starting`, `Stopped`), using ioredis-lifecycle's names.
- Each collection is a Mongo collection of the same name. `Where` translates one to one; `exists` follows Lattice's null rule, not Mongo's `$exists`, and `contains` is an escaped, case-insensitive regex. Filters are combined with `$and`, never spread, so a filter on `id` cannot replace the id lookup.
- A duplicate key (11000) on a write is `CONFLICT` with `{ collection, id }`. `ensure` runs `createIndex`, and an options conflict or a unique index over duplicates passes through.
- Two known differences from `MemoryStore`. Mongo orders strings by UTF-8 bytes, which differs from JavaScript only for U+E000–U+FFFF against astral characters. `contains` folds case differently outside ASCII.
- Tests run on `mongodb-memory-server`: one single-node replica set per run, pinned to mongod 8.0.14, with a database per test.
- A `Patch` sets each key it has; a key set to `undefined` removes the field (Mongo `$unset`). It can never change `id`.
- `MemoryStore` ships in `@latticecms/core` for tests and examples, the way `@hexok/logger` ships `MemoryLogger`. It enforces unique indexes as Mongo does: a missing field keys as null, `ensure` rejects a unique index over existing duplicates, and it rejects an index whose keys exist with other options.
- A store receives a parsed `AnyWhere`, not the typed `Where<Doc>`: validation happened before it.

### Writing a store adapter

An adapter package imports `@latticecms/core/store`: `CollectionStore`, the port types (`StoredDoc`, `Patch`, `FindQuery`, `Page`, `Index`, `AnyWhere`, `FieldOps`) and the cursor helpers (`orderOf`, `after`, `encodeCursor`). It never gets the input schemas or the in-process matcher.

The conformance suite, `@latticecms/core/store/conformance`, is data: `storeCases`, each `{ name, run(store) }`, asserting with `node:assert/strict`. Any test runner runs it, and core takes no runner dependency. The adapter gives each case a fresh store:

```ts
import { storeCases } from '@latticecms/core/store/conformance'

describe('MongoStore conformance', () => {
  let store: MongoStore
  beforeEach(async () => { store = await freshStore() })
  afterEach(() => store.stop())
  it.each(storeCases)('$name', ({ run }) => run(store))
})
```

`MemoryStore` passes the same suite. When a case needs a capability some stores lack, such as transactions, it declares it, and an adapter filters `storeCases`; until then the suite has no options.

### Where filter

`Where<Doc>` is typed from the collection's document, system fields included. Each store translates it; nothing else reaches the database. A query on a field the schema does not have is a type error and a `VALIDATION` error at runtime.

| Field kind | Operators |
| --- | --- |
| string | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists` |
| number | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists` |
| boolean, enum (string or number literals) | `eq`, `ne`, `in`, `nin`, `exists` |
| array of strings, numbers or enums | `has` (an element equals the value), `exists` |
| object, other arrays, anything else | `exists` |

- Several fields, or several operators on one field, all have to match. `and` and `or` take one or more filters and nest.
- Null and missing follow MongoDB's query semantics: `eq: null` matches null or missing, `ne` and `nin` match missing, and a comparison with null or missing is false. `exists` asks whether a field has a value, so null does not exist.
- Strings compare by code unit, so ISO timestamps order correctly. `contains` is a case-insensitive literal substring, never a regex.
- One operator table drives the type and the validator. A field's kind is decided from the values it accepts, the same way on both sides, and a table test checks every Zod field form.
- The generated `find` takes `where`, and ts-pf validates it with the same schema.

Pagination is cursor-based ([0008](decisions/0008-cursor-pagination.md)): `limit` + `after`, ordered by the `sort` fields plus `id`.

- `sort` is an array such as `['-createdAt', 'title']`, not an object, because Zod rebuilds object keys in shape order and would reorder the priority. Only required, non-null string, number and enum fields sort, so a cursor never meets null. The default is `['-createdAt']`; `id` is always the last tiebreak.
- `limit` is 1 to 100, default 20. Both defaults are Zod defaults in `find`'s contract input, so the catalog and OpenAPI show them; `Repo.find` reads the same constants.
- A cursor is opaque base64url JSON of the sort and the last document's sort values. A cursor from another sort, or a malformed one, is `VALIDATION`. It is not signed: a forged cursor only moves the page start, and `where` still applies.
- The keyset predicate is itself a `Where` (`or` of `eq`/`gt`/`lt` clauses), so a store applies it as it applies any filter and has no pagination code of its own. A total comes from the generated `count` operation, `posts.count({ where })`, which a client calls beside `find` ([0026](decisions/0026-totals-come-from-a-count-procedure.md)). It costs a second query, so admin tables call it and APIs usually don't. Page numbers are not offered, because skip-based pages slow down on large Mongo collections.

### Indexes and migrations

- Indexes are declared on the collection. `ensure()` creates missing ones at startup and never drops one.
- Data migrations are `{ id, name, up({ db, session?, signal, logger }) }` objects in an explicit list. `migrate(store, migrations, { logger })` from store-mongo runs the pending ones in order, forward only, and the Phase 3 CLI calls it. A `_migrations` collection records what ran. A lease lock in `_migrations_lock` stops two processes running them at once; the second waits ([0027](decisions/0027-migrations-lock-in-the-database-they-migrate.md)).
- There is no schema migration step for Mongo. A breaking field change is a data migration.

## Relations

Relations are IDs plus explicit join collections ([0004](decisions/0004-no-database-joins.md)). The database never joins, so two related collections can sit in different stores, clusters or regions.

| Kind | Declared with | Stored as |
| --- | --- | --- |
| Belongs to one | `authorId: ref('users', { onDelete? })` | An ID field on the child |
| Many to many, or one to many with metadata | `many('categories', { through, fields })` | A join collection, such as `post_categories`, with `postsId`, `categoriesId` and the `fields` |
| A short ordered list with no metadata | `tagIds: z.array(ref('tags'))` | An ID array on the parent, capped by the schema's `max()` |

Join collections are derived from `many(target, { through, fields?, onDelete? })` ([0028](decisions/0028-relations-delete-in-a-store-transaction-as-system-work.md)). The join collection `through` holds `<parent>Id` (cascading from the parent), `<target>Id` (with `onDelete`, `restrict` or `cascade`) and `fields`. It has the system fields, the parent's tenant field, its own events, a unique index on the pair, and a `Repo` in `repos`. It gets no CRUD slice. Each relation adds two operations to the parent's slice:

- `posts.categories.list({ id, where?, sort?, limit?, after? })` returns `{ docs: Link[], next }`. It runs the parent's `read`: the parent is fetched under that scope, so a parent outside it is `NOT_FOUND`.
- `posts.categories.set({ id, links })` replaces the set by diffing: removed links are deleted, new ones inserted, changed fields updated, and unchanged links keep their id. It runs the parent's `update`, inside a transaction, with up to 1000 links and an event per change. A bypass cannot `set`.
- Both are family use cases, overridable with `overrides: { categories: { set } }`. A relation name cannot be a field, an action, a method or an override, and `many()` cannot target its own collection.

### Population

- A read takes `populate: ['authorId', 'categories']`, one level deep in v1. `get` populates refs and `many()` relations. `find` and a relation's `list` populate refs only, so a call that type-checks is bounded no matter the data: `many()` on `get` is capped by `set`'s 1000 links, and `posts.categories.list({ id, populate: ['categoriesId'] })` pages through a post's categories with their documents.
- Lattice collects IDs per target collection and calls `getMany` once each. Access and tenancy filters apply to the populated documents too.
- A populated document the caller may not read, or one that no longer exists, comes back as `Withheld`, `{ id }` only. A target whose `read` is `false` withholds every document and does not fail the read. `afterRead` runs on populated documents.
- An overridden `get`, `find` or `list` does not populate: its output is plain, so the client type never claims documents the override did not fetch.
- Output types follow `populate`: `authorId` is a `string`, or `User | Withheld` when populated, where `Withheld` is `{ id }`. A caller narrows with `'email' in post.authorId`. ts-pf types this through expandable outputs, so every client gets it without a wrapper ([0022](decisions/0022-populated-reads-use-ts-pf-expandable-outputs.md)).

- `ref(slug)` takes a slug, so two collections can refer to each other. A slug that is not in the framework fails `build()` and `.contract`, in its type and at runtime. The ref marker is a Zod check, so `.min()`, `.optional()` and `z.array()` keep it.
- A write does not check that the referenced id exists: it would cost a query per write, cannot work across stores, and still races a delete. `onDelete` keeps refs from dangling, and population shows a missing target as `Withheld`.
- `ensure()` adds an index for each ref field, led by the tenant field.

### Deleting a parent

Each `ref()` and `many()` declares `onDelete`: `restrict` (default), `cascade` or `nullify` ([0028](decisions/0028-relations-delete-in-a-store-transaction-as-system-work.md)).

- The generated delete runs inside `store.transaction()`. MongoStore uses a transaction on a replica set, and otherwise runs in order with the parent last.
- It plans first: every `restrict` child, however deep, is counted before any write, and one blocks the delete with `REFERENCED`. Then it nullifies, then deletes cascaded children deepest first, then the parent.
- `nullify` unsets an optional ref, nulls a nullable one, or pulls the id from an array. It is a compile error on a required ref. Arrays of refs cannot cascade.
- Cascade recurses and stops at cycles. Each child emits its own `deleted` or `updated` event. All events publish after the transaction commits.
- The child steps are system work: they skip the caller's access functions, but always carry the parent's tenant clause, so another tenant's row neither blocks nor is touched. A global parent's children are found across tenants.
- A cascade never bypasses a soft delete: a collection that overrides `delete` cannot have a `cascade` ref.
- An override of `delete`, and `Repo.remove`, do not run `onDelete`.
- Different stores (later phases): `restrict` is checked before the delete; `cascade` and `nullify` run in an event handler on `<parent>.deleted`. They are eventually consistent and must be idempotent.

## Auth, access and tenancy

Authentication stays in `@hexok/auth` at the edge ([0006](decisions/0006-use-cases-receive-the-actor.md)). Lattice sees only the app's actor, checks access in a family guard, and scopes every query to the actor's tenant.

### Authentication

The edge authenticates, and Lattice never imports `@hexok/auth`. A ts-pf context function reads the credential, `@hexok/auth`'s `Sessions` (or `resolving()`) turns it into the user, and the edge builds the actor. Lattice parses the actor against the family's actor schema. Swapping to the company IdP changes the composition root only.

The edge's context is `CallContext<Actor>`, `{ actor, logger }`; Lattice adds `access`. Its `actor` is typed as a valid actor, so an edge cannot hand Lattice "no actor" without a cast. The edge refuses a missing or bad credential itself, with 401 `UNAUTHORIZED`. Lattice rejects a present but invalid actor with the same code. app-template differs: its edge passes an anonymous caller, and a guard refuses it.

The active organization comes from a request header, `x-organization-id` in `examples/crm`. The edge checks membership on every request, with one indexed `count` on the app's `memberships` collection, before the actor exists. So `tenantOf` reads only a checked organization ([0030](decisions/0030-the-edge-checks-membership-per-request.md)). No organization, not a member, and no such organization are one 403 `FORBIDDEN`. Each refusal's reason is logged, never sent. The session holds only the user. A support actor comes from server config, never from the request.

Procedures with no actor, such as login and logout, live on the app's own small ts-pf router (`/auth` in the crm), outside the Lattice families. In the crm, password hashes live in a store collection that Lattice never registers, so no contract, MCP tool or OpenAPI document can describe them.

### Access

Access is a hexok port, so the decision engine can be replaced:

```ts
abstract class Access<Actor = unknown> extends Port('Access') {
  abstract check(request: AccessRequest<Actor>): Promise<boolean | AnyWhere>
  // The subset of `fields` (the collection's maskable fields) this actor may read. Omitted means withheld.
  abstract readable(request: { actor: Actor; collection: string; fields: readonly string[] }): Promise<readonly string[]>
}

type AccessRequest<Actor> = {
  actor: Actor
  collection: string
  action: 'find' | 'count' | 'get' | 'create' | 'update' | 'delete' | (string & {})  // custom methods too
  data?: unknown // create only: the parsed input
}

// FamilyContext<Actor> = CallContext<Actor> & { access: CallAccess }
interface CallAccess {
  scope<C>(collection: C, action: string, data?: unknown): Promise<Scope<C['slug']>> // throws FORBIDDEN on false
}
```

- Access is a filter in the query ([0005](decisions/0005-access-and-tenancy-are-query-filters.md)).
- The port spans every collection, so its `Where` is untyped. The default adapter is typed per collection where the functions are declared.
- The default adapter reads each collection's `access` functions, Payload style. `find`, `count` and `get` run `read`. A missing function denies, and `access: {}` denies everything. A declared method with no function is a compile error.
- A family guard checks access on every use case: generated, override and method. `false` is `FORBIDDEN`, logged once. Lattice's procedure handler adds `access` to each call's context; a direct caller makes one with `build().context()` ([0023](decisions/0023-access-reaches-use-cases-through-the-call-context.md)).
- `build({ access })` replaces the default adapter, such as with an adapter for another decision engine.
- A default filter, such as hiding soft-deleted rows, is a `read` filter: `read: () => ({ archived: { eq: false } })`.
- Access functions attach at `framework().collection(C, { access })`, where the actor type is known ([0021](decisions/0021-access-attaches-at-composition.md)). Each gets `{ actor }`, and `create` also gets `data`. `read`, `update`, `delete` and custom methods return `boolean | Where<Doc<C>>`; `create` returns `boolean`. A `Where` on a field the collection lacks is a compile error.
- A `Where` result is ANDed with the caller's `where` in `find`, and is the `where` of `get`, `update` and `delete`. A caller can only narrow it. Access is never checked by loading a row and then deciding.
- `false` throws one `FORBIDDEN` error. A row outside a `Where` is `NOT_FOUND`, so callers cannot probe for IDs.
- When `@hexok/authz` ships, it becomes an adapter of this port. Its list checks must return a filter, not only a yes or no.

### Field masking

A field can be withheld from some readers ([0031](decisions/0031-masked-fields-are-withheld-at-the-client-boundary.md)):

```ts
export const Deals = collection('deals', { schema, tenant: 'organizationId', maskable: ['amount'] })

framework({ family: AppUseCase }).collection(Deals, {
  access,
  fields: { amount: { read: ({ actor }) => 'support' in actor || actor.role === 'manager' } },
})
```

- `maskable` names schema fields only. The collection gains `clientOutput`, which is `output` with those fields optional. `ClientDoc<C>` is its type, and `Doc<C>` stays whole.
- `fields` is required exactly when the collection has maskable fields, with one rule per field. A rule gets `{ actor }` and returns `boolean | Promise<boolean>`. It runs once per call per collection, through `Access.readable`; the default adapter answers from `fields`, and a missing answer withholds.
- Masking happens at the implemented router, after `execute` and `afterRead`. So it covers generated operations, overrides, methods, relation `list` and `set`, population (under the target collection's rule) and the documents create and update return. A withheld field is absent. Client types show it as optional for everyone.
- Each maskable field schema carries a marker, as `ref` does, so a `pick`, `extend` or `shape.amount` clone is still found. At `build()`, Lattice walks every procedure's output. A required maskable field, or a schema it cannot see through (`z.lazy`, a transform or pipe, `z.custom`, `z.unknown`), throws. A method declares `Deals.clientOutput`.
- A family guard after access refuses a `where` (at any depth) or `sort` on a field withheld from the caller with `VALIDATION`, naming the path. That covers find and count on every path, including direct `useCases`. A cursor carries its sort, so it cannot carry a withheld value. A maskable field cannot be in a unique index, or be a `ref`.
- Repos, direct `useCases` and events' `doc` are server code and stay whole. A document leaves the product through webhooks, which map it to their own payload.

### Tenancy

Row-level tenancy is the only built-in strategy ([0009](decisions/0009-strict-tenant-isolation-in-v1.md)). It covers the team's organization model.

- `family({ actor, actorId, tenantOf })` names the actor's active organization, or returns `tenancy.bypass` for a platform actor. The edge picks the organization, and sets the platform flag, from the session or a header. The actor schema validates both. `Family<Actor, Tenanted>` records whether `tenantOf` exists, and a tenanted collection in a family without it is a compile error ([0024](decisions/0024-tenant-bypass-is-decided-by-tenant-of.md)).
- A collection with `tenant: 'organizationId'` gets that field in its output, `Doc`, `Where` and `Sort`, never in create or update input. Create stamps it after `beforeChange`, and update never writes it. A schema field with the tenant's name is a compile error.
- Every `Scope` is the tenant clause ANDed with the access `Where`, and carries `tenantId`. Another tenant's row is `NOT_FOUND`. A `tenantOf` that returns no tenant id fails the call, so a missing tenant never widens a filter.
- Join collections inherit the parent's tenant field.
- A collection without `tenant` is global, such as a lookup table.
- No cross-tenant sharing in v1. The tenant filter is one clause that the `Access` port can widen later (own organization OR shared to me), so `@hexok/authz` adds sharing without changing collections.
- `tenancy.bypass` lets a platform actor (support staff, GodMode) read across tenants. A bypass is read-only on tenanted collections: generated writes and repo writes through its scope are `FORBIDDEN`. Its call line carries `tenancy: 'bypass'`, and each bypassed scope logs one `tenancy.bypass` line with the actor, collection and action.
- Server code names its tenant. An event handler uses `tenancy.scope(C, tenantId)`: the tenant clause and no access, and inserts through it are stamped. `unscoped` reads and writes every tenant, but cannot insert into a tenanted collection.
- Generated events of a tenanted collection carry `tenantId: string`. A method's own event declares `tenantId` and fills it from `scope.tenantId`.

Schema-per-tenant and database-per-tenant are possible by routing a collection's `store` per tenant. They are not built in v1.

## Events and side-effects

Events are hexok's event model plus the queue and broadcast ports ([0010](decisions/0010-collection-events-stay-in-the-product.md), [0011](decisions/0011-no-read-events.md)). Use cases publish events after a successful write; event handlers do the side-effects in the worker.

- `collection()` derives three hexok `Event` classes from the schema: `Posts.events.created`, `.updated` and `.deleted`, with tokens `posts.created`, `posts.updated` and `posts.deleted`. Payloads are `{ doc, actorId }`, plus `previous` on update and `tenantId` on a tenanted collection, typed from the schema. They hold no use case references, so the collection stays a pure declaration ([0020](decisions/0020-collection-events-join-the-app-catalog.md)).
- Events publish after the store write succeeds, with `doc` as stored (before `afterRead`). A publish failure reaches the caller although the write happened: the delivery gap below. Overrides and methods publish their own events; Lattice publishes nothing for them.
- `actorId` is the family's `actorId` option, which the family exposes (`AppUseCase.actorId(ctx.actor)`), so log lines and events read one function.
- The app lists them in its own one catalog, next to its hand-written events. Its existing `DomainEventPublisher` and queue adapter then publish them unchanged. `build()` is a compile error when the publisher passed as `build({ events })` cannot take every collection's events, and the error names each refused token. `events` is required; an app with no subscribers passes a no-op publisher.

```ts
export class DomainEvents extends EventCatalog('domain-events', {
  postsCreated: Posts.events.created,
  postsUpdated: Posts.events.updated,
  postsDeleted: Posts.events.deleted,
  postPublished: PostPublishedEvent,
}) {}
```
- Generated use cases publish through the app's `DomainEventPublisher` port, the same one `app-template` uses over `@hexok/queue`.
- Handlers are hexok `EventHandler` classes, subscribed in the worker with one consumer group per handler. Delivery is at least once, so handlers use the event id to stay idempotent.
- Collection events are domain events. They stay inside one product and may change with it.
- Another product never subscribes to them. The app maps a domain event to a versioned `@hexok/integration-events` message at the edge.
- Webhooks to customers are a handler that publishes through `@hexok/webhooks`, with its own webhook catalog, so internal fields never reach a customer endpoint.
- Live UI updates use `@hexok/broadcast` (at most once). Lattice does not publish to it by itself.

### What Lattice does not do

- No read events. Reads are logged and traced.
- No pattern subscriptions such as `/^collection\..*\.deleted$/`. A handler names its event, so the worker can check every subscription at startup.
- No event-driven control flow. A rule that must block a write is in the use case, not a handler.

### Delivery gap

The write goes to Mongo and the event goes to Redis. A crash between the two loses the event. v1 accepts this, as `app-template` does. Phase 4 adds an outbox: the event is written in the same Mongo transaction, and a relay publishes it with a stable id.

## API surfaces

One generated contract serves every surface. Lattice writes no transport code. Each generated procedure carries `.meta()` with a `docs` summary and an `mcp` effect, written in one place (`describe.ts`), so MCP tools, OpenAPI operations and codegen comments describe themselves. `@ts-pf/docs` and `@ts-pf/mcp` are peers of core.

```ts
const handler = new FetchHandler(app, { onError: onError(logger) })
const fetch = async (request: Request) => {
  const result = await handler.handle(request, {
    prefix: '/rpc',
    context: async (req) => ({
      actor: await actorFrom(req),                     // @hexok/auth at the edge
      logger: logger.child({ requestId: req.headers.get('x-request-id') ?? crypto.randomUUID() }),
    }),
  })
  return result.matched ? result.response : new Response('Not Found', { status: 404 })
}
serve({ fetch })                                       // srvx; or Hono, Bun, Next, Astro

const local = createLocalClient(app, { context: { actor, logger } }) // in-process, same guards and errors
await local.posts.find({ where: { status: { eq: 'published' } }, limit: 20 })
```

| Surface | Package | Notes |
| --- | --- | --- |
| HTTP (POST JSON RPC) | `@ts-pf/server-http` | `POST /rpc/posts/find`. Cacheable GET reads use the userland bridge ts-pf already documents |
| In-process | `@ts-pf/server` `createLocalClient`, or `useCases.*` | Tests, scripts, server-rendered pages. Same guards and errors |
| WebSocket, stdio | `@ts-pf/message-server` | For live admin or CLI tools |
| MCP | `@ts-pf/mcp` | Each operation becomes a tool, run in process through the router, so access, tenancy, masking and spans apply. Generated tools carry Lattice's summary and effect (`read`, `write`, `destructive`); a method describes itself. The crm serves `/mcp` over Streamable HTTP with the same bearer session and `x-organization-id` as `/rpc`, and answers a missing session with a 401 challenge. Large apps use tool hosts |
| OpenAPI | `@ts-pf/openapi` | `profile: 'codegen'` for Dart, Swift and Kotlin clients. Populated reads carry `x-ts-pf-expand`. A masked field is optional, with a description; its `where` and `sort` entries say a caller who cannot read it is refused. The crm serves `/openapi.json` to signed-in users only |
| TypeScript clients | `@ts-pf/client` + `client-http`, `@ts-pf/swr`, `@ts-pf/mvc-kit` | Import `contract` only, never server code |
| Split repos | `@ts-pf/codegen` | `.d.ts` from the catalog, plus a breaking-change check in CI |

Errors are a hexok `Errors` catalog mapped once to ts-pf errors, as `app-template`'s `rpc/errors.ts` does. Procedures declare `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409) and `REFERENCED` (409, `{ collection, id, by: { collection, field } }`: a `restrict` child blocks a delete). `VALIDATION` is not declared: it is a ts-pf protocol code, and a `LatticeError` or hexok `CodedError` `VALIDATION` is sent as it, with `{ path, message }[]` issues.

- `framework({ errors: { declared, map } })` takes the app's own client error map and mapper, the ones app-template keeps in `servers/rpc/errors.ts`, unchanged. Every procedure, generated or not, declares Lattice's codes plus the app's, so an override or method can throw an app domain error and a client narrows on it.
- Overrides and methods throw `LatticeError` (exported) for Lattice's own codes, so an override answers a missing id with the same `NOT_FOUND` as the operation it replaces. Hand-written use cases name the document type as `Doc<typeof Deals>`.
- `build()` returns `onError(logger)` for `FetchHandler`. It logs an unexpected error unless the family already logged it as a failure; an app error the app hides from clients (sent as `INTERNAL`) gets the family's `info` line and one `error` line from `onError`, so an error thrown in a use case is logged once and one the family never saw (a context factory throw, an output-validation `INTERNAL`) is still logged.
- An error that is neither Lattice's nor mapped by the app reaches an HTTP client as `INTERNAL`. An in-process `createLocalClient` caller gets the original error, as ts-pf does for any raw throw.
- With ts-pf input validation on, its check runs first, so unknown keys in a strict input arrive as one grouped issue at the object's path; Lattice's own check would name each key.
- One function in `errors.ts` decides whether a thrown value is an expected refusal: a member of any hexok `Errors` catalog, or a hexok `CodedError` `VALIDATION`. The family's logging uses it. Whether a refusal is shown to clients is the transport mapping's decision; one it sends as `INTERNAL` is logged by the edge's `onError`.

REST with path parameters is not offered. If an outside partner needs it, it is a projection plus an executor beside `FetchHandler`, the way ts-pf already plans one.

## Observability

Every generated operation logs and times itself through the family's hexok `hooks()`, with no code in the collection.

- Logging: the call context carries a `@hexok/logger` `Logger`. The edge passes `rootLogger.child({ requestId })`; workers, scripts and tests pass their own. The family's hooks log each call through a child with `actorId`, `collection`, `action`, `durationMs`, and `tenantId` or `tenancy: 'bypass'`. A context logger, not one given to `framework()` or `family()`, because family hooks are fixed when the family is created and see only the call, and because no module has to import a configured logger at load time. Sentry and New Relic attach through `TeeLogger`, as in `app-template`.
- One line per call that passes the guards: `info` with `outcome: 'ok'` on return; `info` with `outcome: 'refused'`, `catalog` and `code` for a member of any hexok `Errors` catalog; `error` with the stack for anything else.
- The family's guards log their own rejections, since hexok runs guards outside hooks. A refusal is logged exactly once on every path: RPC, in process, or `useCases.*.execute`. Lattice's router middleware logs only ts-pf's own input rejections, which no family sees.
- Errors: `onCatch` logs unexpected errors once. The edge passes `build()`'s `onError(logger)` to `FetchHandler`, so the same error is not logged twice (see [API surfaces](#api-surfaces)).
- Tracing goes through `@opentelemetry/api`, a peer of core and store-mongo. With no SDK registered, the API is a no-op: about 0.1 µs per call. There is no option to turn it off. A call makes this tree:

  ```
  deals/find      SERVER    router middleware, active
  ├── deals.find  INTERNAL  family hooks
  └── find deals  CLIENT    MongoStore
  ```

  - **Procedure span:** made by Lattice's one router middleware, which also maps errors and logs ts-pf's input rejections, so every caller gets it with no wiring. ts-pf's call interceptors attach to callers, not routers. Attributes: `rpc.system: 'ts-pf'`, `rpc.service` (the slug), `rpc.method`, `lattice.outcome` (`ok`, `refused`, `failed`) and `lattice.code`. Guard refusals and input rejections appear only here.
  - **Use-case span:** started in `preExecute`, ended in `postExecute` or `onCatch`, on every path, including direct `useCases` calls under a caller's span. Attributes: `lattice.use_case`, `lattice.collection`, `lattice.action`, `lattice.actor_id`, `lattice.tenant_id` or `lattice.tenancy: 'bypass'`, `lattice.outcome` and `lattice.code`. hexok has no around hook, so the span is never active, and a use case's store calls are its siblings.
  - **Store span:** `{operation} {collection}`, with `db.system.name: 'mongodb'`, `db.namespace`, `db.operation.name` (the Mongo command) and `db.collection.name`. A replica-set transaction is one `transaction` span, with its calls as children.
  - A refusal leaves the status unset. An unexpected throw is `ERROR`, with `error.type` and an exception event. A store span records no exception event, because a driver's message can quote values. No span carries input, a document, a masked value or query text.
- Tests: `MemoryLogger`, and an `InMemorySpanExporter` with an async context manager, registered in the test, so assertions can read what was logged and traced.

## Known limits

What the built system does not do yet, or does with a known gap. Each is a candidate for a later phase.

- **Relations.**
  - A collection cannot relate to itself with `many()`; it is a compile error.
  - `restrict` counts every child row, including soft-deleted ones, so an archived deal still blocks deleting its company.
  - Population is one level deep, and `find` populates refs only.
- **Repos.** `Repo.update` writes its patch as given and does not re-validate the merged document, as generated update does.
- **Stores.**
  - `MemoryStore.transaction` restores on a throw, but does not isolate calls made outside `work`.
  - A standalone MongoDB runs a transaction's work in order, without atomicity.
  - `MemoryStore` and MongoDB differ on string order outside the BMP, and on non-ASCII case folding in `contains`.
  - One store serves every collection.
- **Auth.**
  - `CallContext<Actor>` types the actor as the schema's output. Lattice parses it once per call, so an actor schema with a transform makes the edge pass an output-shaped value through the transform again. No app uses a transforming actor schema. When one does, `CallContext` should take the schema's input type.
  - The crm's login limit counts failures per email only: concurrent failures can overshoot it, anyone can lock an email for 15 minutes, and per-IP limiting belongs in front of the app.
  - The `@hexok/authz` adapter waits for hexok to release it.
- **Tracing.** A use-case span cannot parent its store calls until hexok has an around hook. The exception event on a procedure or use-case span carries the thrown error's message, so an app error that interpolates a value puts it in the trace. Log lines do not carry trace ids yet; that would best live in `@hexok/logger`.
- **Field masking.**
  - A field rule sees the actor, not the row.
  - A method field computed from a masked one, an `afterRead` derivation, an object `.refine()` across a maskable field, and an access `Where` on a maskable field can each reveal something about it. The README says not to write them.
- **Type-check cost.** After Phase 2 step 7, core's sources take 1.04–1.06 s (0.98 s after Phase 1), the crm's 0.52–0.54 s, and the crm with tests 0.67–0.71 s, within its 0.75 s limit. The crm's growth since Phase 1 is its own MCP, SDK and codegen surface, not Lattice's per-collection types. Core's sources grew 0.6% for field masking and 0.6% for procedure meta. [0003](decisions/0003-collections-compile-at-runtime.md)'s revisit condition does not hold.
- **OpenAPI names.** The codegen profile makes up component names for unnamed schemas, such as a where field or Lattice's `Withheld` shape. They can change when the contract changes. Named schemas (`.meta({ id })`) would make them stable.

## Proposed changes to hexok and ts-pf

Phase 0 needed one ts-pf fix, released in 0.5.2: client input is typed by the schema's input type, so a defaulted field is optional for callers. Phase 1 needed one ts-pf feature, expandable outputs, released in 0.6.0 ([0022](decisions/0022-populated-reads-use-ts-pf-expandable-outputs.md)). The other items are later needs or nice to have. Each goes through hexok's scope gate or ts-pf's `DECISIONS.md` process before it lands; this table is the input to that discussion, not approval.

| Item | Where | Needed by | Recommendation | Why |
| --- | --- | --- | --- | --- |
| Expandable outputs: `procedure.output(Wide).expand({ key, at, fields })`, so the output type follows a list in the input | ts-pf | Phase 1 step 9 | Released in 0.6.0 and used | Population changes a read's output per call. ts-pf's client is one non-generic signature per procedure, so no Lattice-side type reaches swr, mvc-kit or codegen clients |
| `RouterImplCheck` decides each node by the implementation's node, so a contract node that may be a procedure or a router type-checks | ts-pf (`@ts-pf/server` `runtime.ts`) | Nice to have | Build it | Lattice builds its router at runtime, with relation routers inside slices. Today it calls `router()` through `rootRouter()`, which narrows with runtime guards. The fix is a distributive `NodeCheck`; a fixed contract keeps every error it has today |
| Export `ExpandResult` and `ExpandedOutput` from `@ts-pf/contract` | ts-pf | Nice to have | Build it | A `.d.ts` that names a populating read needs them (TS2883). Lattice exports a `ReadUseCase` interface to work around it |
| `@hexok/authz` | hexok (already planned) | Phase 2 | Build it; add list checks that return a filter | Every product needs it. Lattice adapts its `Access` port to it |
| `openWorldHint` and `idempotentHint` from procedure meta | ts-pf (`@ts-pf/mcp`) | Nice to have | Build it | It maps an effect to `readOnlyHint` and `destructiveHint` only, so every tool is open-world, which is wrong for a closed app. Tools from `all()` also advertise no output schema |
| `Sessions.authenticate` returns when the session ends | hexok (`@hexok/auth`) | Nice to have | Build it | The MCP SDK's `requireBearerAuth` needs `expiresAt`, so the crm answers its own 401 challenge |
| Tracing port | hexok | Phase 2 (done) | No new package. Lattice calls `@opentelemetry/api` directly | The OTel API is already vendor-neutral and a no-op without an SDK, so an app can solve this today (gate question 2) |
| Blob storage port, `@hexok/blob` + `@hexok/blob-s3` | hexok | Phase 3 | Build it, shaped like `email` / `sms` | Any product with uploads needs it. S3 covers DigitalOcean Spaces |
| Mongo client lifecycle | `@latticecms/store-mongo` | Phase 1 (done) | Kept in Lattice | Only the store uses it. Move to hexok when a second package needs it, the way `ioredis-lifecycle` was extracted |
| Outbox relay | `@latticecms/store-mongo` | Phase 4 | Keep it in Lattice | It is Mongo-specific. `@hexok/integration-events` already accepts a stable `id` |
| Middleware context narrowing | ts-pf (`Q4`, deferred to v2) | Nice to have | Wait for ts-pf v2 | Generated routers can declare the actor key up front, as ts-pf documents today |
| Admin metadata on procedures | ts-pf | Phase 3 | No change | Procedure `.meta()` already flows into `catalog()` |
| Named `EventClass<Token, Schema>` interface returned by `Event()` | hexok | Nice to have | Build it | `Event()` returns an anonymous class type, so a consumer's catalog `.d.ts` inlines every event class (3.8k lines for 10 events in `examples/crm`). A named type cuts that about 8 times for every hexok app. Lattice types `Collection.events` with it when released |

## Repository and packages

The repo copies hexok and ts-pf tooling: npm workspaces, Turbo, Biome, Changesets, Vitest, TypeScript 6, Node 22+, ESM only, strict `tsconfig` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Start with one package and add one only when a phase needs it.

```
packages/
  core/            @latticecms/core            collection(), Where, Sort, family(), framework(), build(),
                                               CollectionStore port, MemoryStore, LatticeError;
                                               ref(), many(), populate, Access port, tenancy;
                                               /store (adapter surface), /store/conformance
  store-mongo/     @latticecms/store-mongo     MongoStore, Where translation, migrate()
  admin/           @latticecms/admin           React admin on @shadalaya + @ts-pf/client (Phase 3)
  cli/             @latticecms/cli             scaffold collection, run migrations (Phase 3)
  store-postgres/  @latticecms/store-postgres  (Phase 4)
examples/
  crm/             HTTP process + worker, shaped like hexok's app-template
```

| Package | Depends on | Peer |
| --- | --- | --- |
| `@latticecms/core` | none | `hexok`, `@ts-pf/contract`, `@ts-pf/server`, `@ts-pf/protocol`, `zod` 4, `@hexok/logger` |
| `@latticecms/store-mongo` | `mongodb` | `@latticecms/core` `^0.1.0`, `hexok`, `zod` 4, `@hexok/logger` |
| `@latticecms/admin` | `@ts-pf/client`, `@ts-pf/client-http`, `@ts-pf/docs` | `react`, `@shadalaya/react` |

- hexok and ts-pf are peers, so the app and Lattice share one copy of each class and type ([0029](decisions/0029-hexok-and-ts-pf-are-peers.md)). An adapter's peer range on core is a caret range, never `*`. Every package publishes public.
- Every `@ts-pf/*` package moves together on one version. `@latticecms/core` pins one ts-pf minor and one hexok major, and a bump is its own changeset.
- A package README is its docs page, as in hexok and ts-pf.
- No casts. Where a value built at runtime meets a precise type, one asserted overload states the precise type over an erased implementation. There are 8 in core: `build`, `contractOf`, `patchSchema`, `relationsOf`, `repo`, `sortSchema`, `tenantShapes` and `whereSchema`. Adding one needs a reason in review. Each Zod-typed overload states both of Zod's type parameters, or ts-pf callers get `unknown`.
- `rootRouter()` in `build.ts` calls ts-pf's `router()` through runtime guards, and `ReadUseCase` names a populating read for declaration emit. Both work around ts-pf typing limits and go when ts-pf changes (proposed changes table).
- A compile error that Lattice raises is a `{ '~error': '…' }` property that names the problem. A key union in an error is wrapped in a template literal, so the message prints the union, not an alias.
- `@latticecms/core` ships an agent skill (`skills/lattice/`) that walks a feature from collection to override, the way the `hexok` skill does. Phase 3.

## Phased build plan

Each phase ends at a gate; the next starts when its exit holds. Phase 0 builds the whole collection model on `MemoryStore` first, so the API shape is settled before any Mongo, auth or authz work. Durations are set when the previous phase lands.

| Phase | Scope | Exit |
| --- | --- | --- |
| 0. Kernel, in memory (done) | `collection()`, `family()`, `framework()`, `build()`, `MemoryStore`; generated CRUD use cases, contract slice, event classes; overrides, custom methods, family guards, logging | A three-collection example serves `/rpc` and all tests pass on `MemoryStore` |
| 1. Mongo, relations, access, tenancy (done) | `MongoStore`, `Where` translation, indexes, migrations runner; `ref()`, `many()`, join collections, batched population; `Access` port with default functions, row-level tenancy, `count` | `examples/crm` runs on Mongo; tenant isolation tests pass |
| 2. Production wiring ([plan](plans/phase-2.md)) | `@hexok/auth` recipe, `@hexok/authz` adapter, field masking; integration-events and webhooks recipes, MCP, OpenAPI; OpenTelemetry spans | One internal tool runs in production on Lattice |
| 3. Admin and CLI | Admin SPA from `catalog()` and `.meta()`, on `@shadalaya`; CLI scaffolding and migrations; uploads through `@ts-pf/file` and a blob port | A new tool reaches CRUD, auth and admin in under one day |
| 4. Hardening | Outbox relay, versions and drafts, Postgres store, index and performance tooling, security review | Ongoing; picked up as products need it |
