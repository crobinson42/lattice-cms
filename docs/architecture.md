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
| Use case lifecycle hooks | `hexok` `UseCase.context().guard().hooks()` | Actor, input, access and masked-field checks are family guards. Logging and the use-case span use `preExecute`, `postExecute` and `onCatch` |
| Storage | **Lattice** `CollectionStore` port, built with hexok `Port` / `Adapter` / `Mapper` | One port for every collection; Mongo and memory adapters |
| Query filter (`Where`) | **Lattice** | A small typed filter that each store translates |
| Relations, join collections | **Lattice** | Ref fields, join collections, batched population |
| Tenancy | **Lattice** collection option, fed by the app's actor | Scopes reads and stamps writes with the tenant field |
| Authentication | `@hexok/auth`, `-redis`, `-jose` | The app builds the actor at the edge and checks membership per request ([0030](decisions/0030-the-edge-checks-membership-per-request.md)). Lattice never imports auth |
| Authorization | **Lattice** `Access` port; an `@hexok/authz` adapter when that package ships | Default: per-collection access functions returning `boolean` or a filter, and field rules for masked fields |
| Events | `hexok` `Event` / `EventCatalog` / `EventHandler` + `@hexok/queue` (durable) + `@hexok/broadcast` (at most once) | Each collection carries generated `Event` classes; the app lists them in its own catalog |
| Cross-product events | `@hexok/integration-events` | The app maps a collection event to a versioned contract at the edge |
| Outbound webhooks | `@hexok/webhooks` | An event handler publishes a webhook; no Lattice code |
| Jobs, schedules | `@hexok/queue` + `@hexok/schedule-coordinator` | Scheduled use cases, as in hexok's `app-template` |
| Logger, error capture | `@hexok/logger`, `-sentry`, `-newrelic` | On the call context: `ctx.logger`, built at the edge |
| Tracing | `@opentelemetry/api`, a peer, called directly | A router middleware span per procedure, use case hooks, and a span per MongoStore call |
| Custom methods | `hexok` `UseCase` | `.collection(Posts, { methods: { publish: PublishPost } })` adds it to the collection's router slice |
| HTTP | `@ts-pf/server-http` `FetchHandler` | Mount on srvx, Hono, Bun, Next or Astro |
| In-process calls | `@ts-pf/server` `createLocalClient`, or calling use cases directly | Same middleware and errors as HTTP |
| GraphQL | Not planned | ts-pf is RPC; OpenAPI covers outside callers |
| MCP tools | `@ts-pf/mcp` | Every operation becomes a tool, described by Lattice's procedure meta |
| OpenAPI, other languages | `@ts-pf/openapi`, `@ts-pf/codegen` | Codegen profile for non-TypeScript clients |
| Typed clients | `@ts-pf/client` + `client-http`, `@ts-pf/swr`, `@ts-pf/mvc-kit` | Web and admin clients use the same contract |
| File uploads | `@ts-pf/file` (multipart) + `@hexok/blob` (not released) | Not built. Picked up when an app needs files; a brief for `@hexok/blob` and `@hexok/blob-s3` is with the maintainer |
| Admin UI | **Lattice** `admin` package: a React component that renders the `catalog()` JSON the app serves ([0032](decisions/0032-the-admin-is-a-react-package-fed-by-the-served-catalog.md)) | `examples/crm` serves it at `/admin` |
| CLI | **Lattice** `cli`, bin `lattice` ([0034](decisions/0034-the-cli-edits-app-code-or-refuses-and-runs-built-code.md)) | Scaffolds collections and migrations, and runs migrations |

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
- `ref()` and `many()` are the only field helpers. Everything else is plain Zod. A field's label for a client is its name in words, or its Zod `.meta({ title })`.
- `label: { singular, plural }` is optional, and it defaults from the slug (`deal_stages` reads "deal stage" and "deal stages"). Generated summaries and the admin use it. A join collection's label comes from its `through` slug ([0033](decisions/0033-the-catalog-carries-lattice-facts-and-the-admin-derives-its-ui.md)).
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
  overrides: ({ repos, generated }) => ({ posts: {
    update: new UpdatePost({ update: generated.posts.update }), // adds a rule, then runs the generated update
    delete: new ArchivePost({ posts: repos.posts }),            // changes what delete does
  } }),
})
```

- The definition (`framework({ family, errors })` and `.collection()`) gives `contract` with no store and no publisher. The wiring (`build({ store, events, access?, methods, overrides })`) needs both ([0018](decisions/0018-methods-and-overrides-attach-in-the-framework.md), [0020](decisions/0020-collection-events-join-the-app-catalog.md)).
- `.collection(C, { access, fields, methods, overrides })` declares the access functions, the field rules and the classes. `access` is required ([0021](decisions/0021-access-attaches-at-composition.md)), and `fields` is required exactly when `C` has maskable fields. The classes' static schemas type the contract, so the definition module imports the use case classes; they load with no ports or I/O, and a browser client imports the contract with `import type`.
- `build()` takes one factory each for methods and overrides. Each receives the typed `repos`, and the overrides factory also receives `generated`, and returns one instance per declared class, keyed by slug and then name, the same shape as the contract. Each is required exactly when a collection declared one.
- A `Repo<C>` has `get(id, scope)`, `getMany(ids, scope)`, `find({ where?, sort?, limit?, after? }, scope)`, `count(where, scope)`, `insert(data, scope)`, `update(id, patch, scope)` and `remove(id, scope)`, typed from `C`. It stamps `id`, `createdAt` and `updatedAt` like the generated operations, and runs no hooks, events or access: it is trusted, like a hexok repository. `insert` takes the schema's input type and parses it as `create` does, so defaults apply and a bad document is `VALIDATION`. `update` writes its typed patch as given, without re-validating the merged document as the generated update does. A key set to `undefined` removes the field.
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
- `update` is a partial patch. A patch never applies schema defaults, so an omitted field keeps its stored value. `null` clears an optional field with no default: the key is removed. A nullable field stores `null`, and a required or defaulted field refuses `null` at its path. Its summary says so. The merged document is validated with the whole schema, so an object-level `.refine()` holds on update as on create. A refinement checks input only: outputs are built from the schema's fields plus the system and tenant fields, so a refined collection works with refs, population and masked fields. A stored key the schema no longer has is removed. Only changed fields and `updatedAt` are written. A stored document that no longer fits the schema fails `update` until a migration fixes it.
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
- An override that adds a rule calls the operation it replaces ([0036](decisions/0036-an-override-can-call-the-generated-operation.md)). The overrides factory receives `generated`, which holds only the declared overrides: `generated.<slug>.<operation>(ctx, input)`, and `generated.<slug>.<relation>.<op>` for a relation. It runs the operation's body: the input parse, the access scope, hooks, the store write and events. It runs none of the family's guards, logging or spans, which the override's own use case ran, so each runs once. It returns the stored `Doc<C>`, and the router masks the override's result. The override's `execute` declares `CreateInput<C>` or `UpdateInput<C>`, checks, and returns `generated`. The crm's `UpdateDeal` and `CreateDeal` refuse a won or lost stage that way, so only `deals.close` closes a deal.
- A body checks what its own action needs, as the guards do and through the same helpers: create's access with its parsed data, a withheld field in a patch or a query, and populate keys. A body called from another operation's override skips nothing.
- An override that changes what the operation does, such as `ArchivePost`, writes through `repos` and publishes its own events.
- Slugs and method names cannot be ts-pf implementer keys (`$context`, `use`, `useAfter`, `middleware`, `router`), and a method cannot reuse a generated operation's name.
- A method publishes its own events from the app's catalog. Generated event classes cover CRUD only.
- A method also declares `summary` and `effect` statics, which become its procedure's `docs` and `mcp` meta, so MCP and the admin describe it from one place. A method without them is a compile error and a throw at `.collection()`. An override with either is too: it keeps the generated operation's meta.

### Hooks

Collection hooks transform data and nothing else: `beforeChange` and `afterRead` ([0019](decisions/0019-hooks-are-before-change-and-after-read.md)). They run inside the generated use cases, in this order: validate input (on update: read, merge, validate the merged document), `beforeChange`, store write, `afterRead` on every returned document. `beforeChange` receives `{ data, operation, previous? }`, where `data` is the whole document after the change on create and update alike. There is no `beforeValidate`: ts-pf validates input at the edge before any Lattice code runs. Business rules belong in an entity method or an override. Side-effects after a change are event handlers. Cross-cutting behavior (tracing, logging, timing) and error handling use the family's hexok `hooks()` and `onCatch`.

## Storage

Every collection talks to one hexok port, `CollectionStore`. MongoDB is the default adapter ([0002](decisions/0002-mongodb-is-the-default-store.md)). One `build({ store })` serves every collection today. A per-collection store, so one app can keep collections on different clusters or regions, is not built yet.

```ts
abstract class CollectionStore extends Port('CollectionStore') {
  abstract ensure(collection: string, indexes: readonly Index[]): Promise<void> // creates missing indexes, never drops one
  abstract find(q: FindQuery): Promise<Page>                                     // { docs, next }; where, sort, optional, limit, after
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
- Sorts follow three plans. With no ascending optional key, it uses a plain sort, served by an index, because Mongo already puts null last on a descending key. When the first key is the only ascending optional one, it runs two queries: rows with a value (index-served), then rows without, only when the page is short, and never once the cursor is past the values. Any other ascending optional key uses an aggregate with a computed missing flag, which sorts in memory.
- Two known differences from `MemoryStore`. Mongo orders strings by UTF-8 bytes, which differs from JavaScript only for U+E000–U+FFFF against astral characters. `contains` folds case differently outside ASCII.
- Tests run on `mongodb-memory-server`: one single-node replica set per run, pinned to mongod 8.0.14, with a database per test.
- A `Patch` sets each key it has; a key set to `undefined` removes the field (Mongo `$unset`). It can never change `id`.
- `MemoryStore` ships in `@latticecms/core` for tests and examples, the way `@hexok/logger` ships `MemoryLogger`. It enforces unique indexes as Mongo does: a missing field keys as null, `ensure` rejects a unique index over existing duplicates, and it rejects an index whose keys exist with other options.
- A store receives a parsed `AnyWhere`, not the typed `Where<Doc>`: validation happened before it.

### Writing a store adapter

An adapter package imports `@latticecms/core/store`: `CollectionStore`, the port types (`StoredDoc`, `Patch`, `FindQuery`, `Page`, `Index`, `AnyWhere`, `FieldOps`) and the cursor helpers (`orderOf(sort, optional)`, `after`, `encodeCursor`, `cursorValues`). It never gets the input schemas or the in-process matcher.

- `FindQuery.optional` names the sort fields a document may lack, filled by core from the output schema ([0037](decisions/0037-an-optional-field-sorts-with-missing-values-last.md)). A store orders a document with no value (missing or null) for an optional key after every document with one, in either direction, and ties it with the others that lack one. Where no ascending key is optional, a plain sort is enough. A required key orders as before.

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

- `sort` is an array such as `['-createdAt', 'title']`, not an object, because Zod rebuilds object keys in shape order and would reorder the priority. String, number and enum fields sort, optional and nullable ones included. A row with no value comes after every row with one, in either direction ([0037](decisions/0037-an-optional-field-sorts-with-missing-values-last.md)). A sort item is an enum of the sortable keys, ascending and descending, so a client sees every valid key; codegen types it as a union of literals. The default is `['-createdAt']`; `id` is always the last tiebreak.
- `limit` is 1 to 100, default 20. Both defaults are Zod defaults in `find`'s contract input, so the catalog and OpenAPI show them; `Repo.find` reads the same constants.
- A cursor is opaque base64url JSON of the sort and the last document's sort values, with null for a missing one. A cursor from another sort, or a malformed one, is `VALIDATION`. It is not signed: a forged cursor only moves the page start, and `where` still applies.
- The keyset predicate is itself a `Where` (`or` of `eq`/`gt`/`lt` clauses), so a store applies it as it applies any filter and has no pagination code of its own. A total comes from the generated `count` operation, `posts.count({ where })`, which a client calls beside `find` ([0026](decisions/0026-totals-come-from-a-count-procedure.md)). It costs a second query, so admin tables call it and APIs usually don't. Page numbers are not offered, because skip-based pages slow down on large Mongo collections.

### Indexes and migrations

- Indexes are declared on the collection. `ensure()` creates missing ones at startup and never drops one.
- Data migrations are `{ id, name, up({ db, session?, signal, logger }) }` objects in an explicit list. `migrate(store, migrations, { logger })` from store-mongo runs the pending ones in order, forward only, and `lattice migrate` calls it. A `_migrations` collection records what ran. A lease lock in `_migrations_lock` stops two processes running them at once; the second waits ([0027](decisions/0027-migrations-lock-in-the-database-they-migrate.md)).
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
- A ref's JSON Schema carries `x-lattice-ref: '<slug>'` wherever the field appears, including a join collection's ids, so a client knows where an id points. The runtime marker and the meta are written together in `ref()`.
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

Procedures with no actor, such as login and logout, live on the app's own small ts-pf router (`/auth` in the crm), outside the Lattice families. So does the crm's `organizations`, which lists the caller's organizations by name for a switcher: it needs a session but no organization, and reads memberships and the global `organizations` collection as trusted edge code. In the crm, password hashes live in a store collection that Lattice never registers, so no contract, MCP tool or OpenAPI document can describe them.

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
- A family guard checks access on every use case: generated, override and method. `false` is `FORBIDDEN`, logged once. Each function runs once per call. Create's answer is kept with a copy of its data, so the guard and the create body ask once; an override that changes the data, or a default that differs per parse (an id, a timestamp), asks again. Create's function receives the data parsed by the collection's schema, for an override of create too. Lattice's procedure handler adds `access` to each call's context; a direct caller makes one with `build().context()` ([0023](decisions/0023-access-reaches-use-cases-through-the-call-context.md)).
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
- Each maskable field schema carries a marker, as `ref` does, so a `pick`, `extend` or `shape.amount` clone is still found. Its JSON Schema also carries `x-lattice-maskable: true`, and it keeps the meta the app gave it, such as a `title`. At `build()`, Lattice walks every procedure's output. A required maskable field, or a schema it cannot see through (`z.lazy`, a transform or pipe, `z.custom`, `z.unknown`), throws. A method declares `Deals.clientOutput`.
- A family guard after access refuses a `where` (at any depth) or `sort` on a field withheld from the caller with `VALIDATION`, naming the path. That covers find and count on every path, including direct `useCases`. A cursor carries its sort, so it cannot carry a withheld value. A maskable field cannot be in a unique index, or be a `ref`.
- On update, a patch that names a field withheld from the caller, with a value or `null`, is `VALIDATION` at that field's path ([0035](decisions/0035-a-caller-cannot-update-a-field-withheld-from-it.md)). The same family guard checks it, on action `update`, before `execute`, so overrides are covered. The update, find and count bodies run the same check, from one helper, for a call through `generated`. Create keeps blind writes.
- Repos, direct `useCases` and events' `doc` are server code and stay whole. A document leaves the product through webhooks, which map it to their own payload.

### Tenancy

Row-level tenancy is the only built-in strategy ([0009](decisions/0009-strict-tenant-isolation-in-v1.md)). It covers the team's organization model.

- `family({ actor, actorId, tenantOf })` names the actor's active organization, or returns `tenancy.bypass` for a platform actor. The edge picks the organization, and sets the platform flag, from the session or a header. The actor schema validates both. `Family<Actor, Tenanted>` records whether `tenantOf` exists, and a tenanted collection in a family without it is a compile error ([0024](decisions/0024-tenant-bypass-is-decided-by-tenant-of.md)).
- A collection with `tenant: 'organizationId'` gets that field in its output, `Doc`, `Where` and `Sort`, never in create or update input. Its JSON Schema carries `x-lattice-tenant: true`, so a client shows it read-only. Create stamps it after `beforeChange`, and update never writes it. A schema field with the tenant's name is a compile error.
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
- Events publish after the store write succeeds, with `doc` as stored (before `afterRead`). A publish failure reaches the caller although the write happened: the delivery gap below. An override that calls `generated` publishes what the generated operation does. Other overrides and methods publish their own events; Lattice publishes nothing for them.
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

One generated contract serves every surface. Lattice writes no transport code. Each procedure carries `.meta()` with a `docs` summary and an `mcp` effect, written in one place (`describe.ts`), so MCP tools, OpenAPI operations and codegen comments describe themselves. A summary names the collection by its label ("Get one deal by id."), and a method's comes from its statics. Each procedure also carries `lattice` meta, typed as the exported `LatticeMeta`: its collection, label and operation, plus a relation and its target collection, or a method name. The admin reads it from the catalog instead of guessing from paths ([0033](decisions/0033-the-catalog-carries-lattice-facts-and-the-admin-derives-its-ui.md)). `@ts-pf/docs` and `@ts-pf/mcp` are peers of core.

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
| MCP | `@ts-pf/mcp` | Each operation becomes a tool, run in process through the router, so access, tenancy, masking and spans apply. Every tool carries its summary and effect (`read`, `write`, `destructive`): generated, or from a method's statics. The crm serves `/mcp` over Streamable HTTP with the same bearer session and `x-organization-id` as `/rpc`, and answers a missing session with a 401 challenge. Large apps use tool hosts |
| OpenAPI | `@ts-pf/openapi` | `profile: 'codegen'` for Dart, Swift and Kotlin clients. Populated reads carry `x-ts-pf-expand`. A masked field is optional, with a description; its `where` and `sort` entries say a caller who cannot read it is refused. The crm serves `/openapi.json` to signed-in users only |
| TypeScript clients | `@ts-pf/client` + `client-http`, `@ts-pf/swr`, `@ts-pf/mvc-kit` | Import `contract` only, never server code |
| Split repos | `@ts-pf/codegen` | `.d.ts` from the catalog, plus a breaking-change check in CI |

Errors are a hexok `Errors` catalog mapped once to ts-pf errors, as `app-template`'s `rpc/errors.ts` does. Procedures declare `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409) and `REFERENCED` (409, `{ collection, id, by: { collection, field, relation? } }`: a `restrict` child blocks a delete; `relation: { collection, name }` names the parent relation when `by.collection` is a join collection). `VALIDATION` is not declared: it is a ts-pf protocol code, and a `LatticeError` or hexok `CodedError` `VALIDATION` is sent as it, with `{ path, message }[]` issues.

- `framework({ errors: { declared, map } })` takes the app's own client error map and mapper, the ones app-template keeps in `servers/rpc/errors.ts`, unchanged. Every procedure, generated or not, declares Lattice's codes plus the app's, so an override or method can throw an app domain error and a client narrows on it.
- Overrides and methods throw `LatticeError` (exported) for Lattice's own codes, so an override answers a missing id with the same `NOT_FOUND` as the operation it replaces. Hand-written use cases name the document type as `Doc<typeof Deals>`.
- `build()` returns `onError(logger)` for `FetchHandler`. It logs an unexpected error unless the family already logged it as a failure; an app error the app hides from clients (sent as `INTERNAL`) gets the family's `info` line and one `error` line from `onError`, so an error thrown in a use case is logged once and one the family never saw (a context factory throw, an output-validation `INTERNAL`) is still logged.
- An error that is neither Lattice's nor mapped by the app reaches an HTTP client as `INTERNAL`. An in-process `createLocalClient` caller gets the original error, as ts-pf does for any raw throw.
- With ts-pf input validation on, its check runs first, so unknown keys in a strict input arrive as one grouped issue at the object's path; Lattice's own check would name each key.
- One function in `errors.ts` decides whether a thrown value is an expected refusal: a member of any hexok `Errors` catalog, or a hexok `CodedError` `VALIDATION`. The family's logging uses it. Whether a refusal is shown to clients is the transport mapping's decision; one it sends as `INTERNAL` is logged by the edge's `onError`.

REST with path parameters is not offered. If an outside partner needs it, it is a projection plus an executor beside `FetchHandler`, the way ts-pf already plans one.

### Admin

`@latticecms/admin` exports `<Admin fetch catalogUrl basePath header />` and `@latticecms/admin/admin.css` ([0032](decisions/0032-the-admin-is-a-react-package-fed-by-the-served-catalog.md)). It renders the served catalog, so its types import no app contract and its type-check does not grow with collections.

- It loads the catalog through the app's `fetch` and narrows it with a type guard over only what it reads. An unreadable catalog names the first thing it could not read. Procedures group by `lattice.collection`, and a relation's target comes from `lattice.target`. Nothing is read from paths.
- It calls procedures by path through `FetchLink`, with swr keys `[path, input]` and its own cache per mount. A refusal is never retried. Focus refetches.
- Its router runs on the History API under `basePath`. It follows back, forward and its own links, not the app's `pushState`. A list keeps its filters, sort and cursors in its query, so back and reload return to them.
- Everything is derived, as 0033 says. Columns are the title field, then required scalars up to six, then `updatedAt`. A maskable field that no loaded document carries is withheld from this caller, because field rules are per actor, so its column is left out. A `VALIDATION` on a filter or sort shows at that control.
- Its routes are `/:collection`, `/:collection/new`, `/:collection/:id`, `/:collection/:id/edit` and `/:collection/:id/relations/:relation`.
- One renderer turns an input schema into a form, for create, edit, methods and a relation's link fields: text, date-time (local in, ISO out), enum, number, boolean, ref (a picker over the target's title field), lists, and JSON for anything else. A form sends only what differs from the values it opened with, so edit is a patch and never sends a withheld field.
- One display shows a refusal. `VALIDATION` issues sit at their fields, and the rest show in the alert. `REFERENCED` names the child collection and field, and links to that list filtered to this document. For a relation's link it names the parent collection and relation, and links to the parents' list.
- A method whose input has `id` is an action on a document; one without is an action on the list. A write or destructive method confirms first. Delete and a relation's `set` confirm too. After a write, one helper revalidates the touched collections' procedures.
- The crm mounts it at `/admin` (`examples/crm/src/web`): a sign-in form on `/auth`, a `fetch` that adds the token and `x-organization-id` and signs out on a 401, and a switcher from `/auth/organizations` in `header`. `<Admin>` is keyed by organization. Vite builds the page into `dist/web`, and the HTTP handler serves it: hashed assets cached for good, and `index.html` for every other `/admin` route. A crm test holds the gzipped bundle to a budget (132 KB in all today, 56 KB without React), and one Chromium test drives it against the real server and mongod.
- `admin.css` is compiled at the admin's build over its own classes and the shadalaya components it imports. A test checks that list against the imports. It is 8.9 KB gzipped, and the bundle is 64.4 KB gzipped without React, most of it Base UI behind the confirmation dialog. Booleans and enum lists are native checkboxes, which saves 4.9 KB.

### CLI

`@latticecms/cli` is a tool with no exports ([0034](decisions/0034-the-cli-edits-app-code-or-refuses-and-runs-built-code.md)). Its peers are core, `typescript` (5.8 to 6, the app's own, resolved from the app; TypeScript 7, the native compiler, has no JavaScript API and is refused), and store-mongo and `@hexok/logger` as optional peers.

- `lattice collection <slug> [--tenant f | --global] [--label s,p] [--dry-run]` writes the collection (a required `name`, so it has a title field), a test of what the scaffold made that builds nothing (the app's contract has the slug and its six operations, and the schema parses `{ name: 'First' }` and refuses `{}` at `name`), so a later ref, method or override never breaks it, its registration in the composition with access open to any signed-in caller, and its three events in the app's catalog.
- It parses each file with the app's TypeScript and inserts text. It never reprints a file. Inserted text keeps the file's comments, newlines and indentation, and follows Biome's line breaks one level deep. A file it cannot place the edit in, a name that clashes with a declaration or import, or an existing slug is exit 1: nothing is written, and the lines it would have added are printed. Writes are staged and placed together; a failure restores every file.
- `lattice migration <name> [--transaction] [--dry-run]` writes the next numbered migration and appends it to the list, with the same edits. The next id comes from the list's ids, and a gap or a duplicate is refused in `migrate()`'s words. The stub's `up()` throws until it is written, so a deploy can never record an unwritten migration as done.
- `lattice migrate` imports the app's built module, which exports `{ store, migrations }`, and checks both. It starts the store, runs store-mongo's `migrate()` with a console logger, and stops the store. Its output is `migrate()`'s log, and a failure is exit 1 with one line. store-mongo and `@hexok/logger` are resolved from the app, as optional peers, only for this command. The crm's module is `src/servers/scripts/migrate.ts`, and its store settings live in `src/infra/store.ts`.
- Config is the optional `"lattice"` key in the app's `package.json`: the collections directory, the composition, the events catalog, the migrations directory, the built migrate module, and `tenant`, which has no default. Every path must be inside the app; a command checks that the paths it needs exist. The paths default to the crm's layout, and the crm sets `tenant: 'organizationId'`. A bad config is exit 2, naming the key.
- Core exports `labelOf`, `reservedNames` and `reservedFields` for tools, so the CLI copies none of core's rules.

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
- **Type-check cost.** Budgets count type instantiations, which do not drift with the machine: core's sources at most 462k (433k today), the crm server's check (`tsconfig.check.json`) at most 660k (642k; raised until the hexok fix lands, then re-measured and lowered), and the admin's sources at most 27k (25k). Over budget means stop and ask the maintainer. Wall time is reported for context: about 1.0 s, 0.8 s and 0.3 s. The crm's check skips declaration emit, which `tsc -b` still checks, and its admin page and browser test have their own project (`tsconfig.web.json`). A plain tenanted collection costs about 4k in Lattice's own types, flat, plus its MCP share: ts-pf's `all(tk)` grows by about 1.3k with each collection already present (about 24k for the seventh). The first hand-written use case on a collection (method or override) costs about 50k more, once, most of it hexok's `family()` statics. Both are upstream, with briefs in the table below. A plain optional field costs about 1.8k (its where operators across `find` and `count`), and a `many()` relation about 44k. Most of a relation's cost is its join collection. Hexok's anonymous `Event()` class types make declarations large. A generic alias over the whole entries map needs stated variances (`in out E`), or every app pays for TypeScript to measure them: `generated` cost the crm about 1.5M instantiations without them. [0003](decisions/0003-collections-compile-at-runtime.md)'s revisit condition does not hold yet.
- **Labels and meta.** The slug-to-singular default handles common English endings only; `news` or `people` declare a label. Zod meta keys are not checked for typos, because Zod's JSON Schema meta has an index signature.
- **Admin.** An app's Vite build warns about `"use client"` directives in swr and Base UI; the admin README says to filter `MODULE_LEVEL_DIRECTIVE`. A `REFERENCED` from a `many()` relation links to the parents' list unfiltered: no read gives a target's parents yet (Phase 4).
- **Getting started.** A reader types or pastes about 290 lines, most of it the edge and the token page. Shrinking them would take exports (a member edge in core, a token page in the admin); not proposed until a second real app repeats them.
- **File uploads.** Not built. A collection cannot declare a file field until `@hexok/blob` exists.
- **OpenAPI names.** The codegen profile makes up component names for unnamed schemas, such as a where field or Lattice's `Withheld` shape. They can change when the contract changes. Named schemas (`.meta({ id })`) would make them stable.

## Proposed changes to hexok and ts-pf

Phase 0 needed one ts-pf fix, released in 0.5.2: client input is typed by the schema's input type, so a defaulted field is optional for callers. Phase 1 needed one ts-pf feature, expandable outputs, released in 0.6.0 ([0022](decisions/0022-populated-reads-use-ts-pf-expandable-outputs.md)). The other items are later needs or nice to have. Each goes through hexok's scope gate or ts-pf's `DECISIONS.md` process before it lands; this table is the input to that discussion, not approval.

| Item | Where | Needed by | Recommendation | Why |
| --- | --- | --- | --- | --- |
| Expandable outputs: `procedure.output(Wide).expand({ key, at, fields })`, so the output type follows a list in the input | ts-pf | Phase 1 step 9 | Released in 0.6.0 and used | Population changes a read's output per call. ts-pf's client is one non-generic signature per procedure, so no Lattice-side type reaches swr, mvc-kit or codegen clients |
| `family()` statics typed `S & ReservedOk<S>` instead of `ReservedOk<S> & Spec` | hexok | crm-app plan, step 1d | Brief: [`briefs/hexok-family-statics.md`](briefs/hexok-family-statics.md) | Intersecting with `Spec` costs about 38k instantiations per collection that has a hand-written use case, and the proposed signature about 22 |
| `all(tk)` linear in the number of procedures | `@ts-pf/mcp` | crm-app plan, step 1d | Brief: [`briefs/ts-pf-mcp-all-tools.md`](briefs/ts-pf-mcp-all-tools.md) | `AllTools` grows quadratically: each collection costs about 1.3k more for every collection already present |
| `RouterImplCheck` decides each node by the implementation's node, so a contract node that may be a procedure or a router type-checks | ts-pf (`@ts-pf/server` `runtime.ts`) | Nice to have | Build it | Lattice builds its router at runtime, with relation routers inside slices. Today it calls `router()` through `rootRouter()`, typed by ts-pf's own declared return and checked by `router()` at runtime (ts-pf 1.0 made `isImplementedProcedure` internal). The fix is a distributive `NodeCheck`, or a public `isImplementedRouter`; a fixed contract keeps every error it has today |
| Export `ExpandResult` and `ExpandedOutput` from `@ts-pf/contract` | ts-pf | Nice to have | Build it | A `.d.ts` that names a populating read needs them (TS2883). Lattice exports a `ReadUseCase` interface to work around it |
| `@hexok/authz` | hexok (three unmerged designs) | When released | Build it; add list checks that return a filter | Every product needs it. Lattice adapts its `Access` port to it |
| `openWorldHint` and `idempotentHint` from procedure meta | ts-pf (`@ts-pf/mcp`) | Nice to have | Build it | It maps an effect to `readOnlyHint` and `destructiveHint` only, so every tool is open-world, which is wrong for a closed app. Tools from `all()` also advertise no output schema |
| `Sessions.authenticate` returns when the session ends | hexok (`@hexok/auth`) | Nice to have | Build it | The MCP SDK's `requireBearerAuth` needs `expiresAt`, so the crm answers its own 401 challenge |
| Adapter packages take `hexok` as a peer | hexok (`@hexok/auth`, `auth-jose`, `auth-redis`, and likely others) | Nice to have | Build it | They list `hexok` in `dependencies`, so a split range installs two copies of hexok's classes (0029's reason) |
| An `around` hook on use cases | hexok | Nice to have | Build it | Hooks run as separate awaited steps, so no span or AsyncLocalStorage context can be active during `execute`. A use-case span cannot parent its store calls |
| Trace ids in log lines | `@hexok/logger` | Nice to have | Build it | One OTel-aware logger joins logs and traces for every hexok app and library |
| Spans and context propagation in queue, webhooks and integration-events | hexok | Nice to have | Build it | Every app writes its own consumer span, and no trace crosses the queue. The crm's `subscribeHandler` is a model |
| A public memory queue with delay and retries | `@hexok/queue` | Nice to have | Build it | Every app testing webhooks without Redis writes one. The crm's `test/memory-queue.ts` is a model |
| Export `MessageClass` | `@hexok/integration-events` | Phase 2 step 6 | Released in 0.2.2 and used | A declaration-emitting app could not export a message class (TS2883) |
| Tracing port | hexok | Phase 2 (done) | No new package. Lattice calls `@opentelemetry/api` directly | The OTel API is already vendor-neutral and a no-op without an SDK, so an app can solve this today (gate question 2) |
| Blob storage port, `@hexok/blob` + `@hexok/blob-s3` | hexok | When an app needs files | Build it, shaped like `email` / `sms`; brief with the maintainer | Any product with uploads needs it. S3 covers DigitalOcean Spaces |
| Mongo client lifecycle | `@latticecms/store-mongo` | Phase 1 (done) | Kept in Lattice | Only the store uses it. Move to hexok when a second package needs it, the way `ioredis-lifecycle` was extracted |
| Outbox relay | `@latticecms/store-mongo` | Phase 4 | Keep it in Lattice | It is Mongo-specific. `@hexok/integration-events` already accepts a stable `id` |
| Middleware context narrowing | ts-pf (`Q4`, deferred to v2) | Nice to have | Wait for ts-pf v2 | Generated routers can declare the actor key up front, as ts-pf documents today |
| Admin metadata on procedures | ts-pf | Phase 3 | Not needed | Procedure `.meta()` and Zod `.meta()` already flow into `catalog()` ([0033](decisions/0033-the-catalog-carries-lattice-facts-and-the-admin-derives-its-ui.md)) |
| Named `EventClass<Token, Schema>` interface returned by `Event()` | hexok | Nice to have | Build it | `Event()` returns an anonymous class type, so a consumer's catalog `.d.ts` inlines every event class (3.8k lines for 10 events in `examples/crm`). A named type cuts that about 8 times for every hexok app. Lattice types `Collection.events` with it when released |

## Repository and packages

The repo copies hexok and ts-pf tooling: npm workspaces, Turbo, Biome, Changesets, Vitest, TypeScript 6, Node 22+, ESM only, strict `tsconfig` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Start with one package and add one only when a phase needs it.

```
packages/
  core/            @latticecms/core            collection(), Where, Sort, family(), framework(), build(),
                                               CollectionStore port, MemoryStore, LatticeError;
                                               ref(), many(), populate, Access port, tenancy,
                                               field masking, procedure meta, catalog facts, spans;
                                               /store (adapter surface), /store/conformance
  store-mongo/     @latticecms/store-mongo     MongoStore, Where translation, migrate(), spans
  admin/           @latticecms/admin           <Admin>: renders the served catalog, on @shadalaya + swr
  cli/             @latticecms/cli             lattice collection, migration and migrate
  docs/            @latticecms/docs            the Starlight site, private: pages generated from the READMEs
  store-postgres/  @latticecms/store-postgres  (Phase 4)
examples/
  crm/             The reference app, not a product: HTTP (/rpc, /mcp, /auth, /openapi.json, /catalog.json, /admin)
                   and a worker (webhooks, integration events), shaped like hexok's app-template
```

| Package | Depends on | Peer |
| --- | --- | --- |
| `@latticecms/core` | none | `hexok`, `@ts-pf/contract`, `@ts-pf/server`, `@ts-pf/protocol`, `@ts-pf/docs`, `@ts-pf/mcp`, `zod` 4, `@hexok/logger`, `@opentelemetry/api` |
| `@latticecms/store-mongo` | `mongodb` | `@latticecms/core` `^0.1.0`, `hexok`, `zod` 4, `@hexok/logger`, `@opentelemetry/api` |
| `@latticecms/admin` | `@shadalaya/react` `0.1.0` (exact: the prebuilt CSS matches it), `swr` `^2` | `react` and `react-dom` `^19`, `@ts-pf/client-http`, `@ts-pf/protocol`. Core, `@ts-pf/docs` and `@ts-pf/client` are types only, so devDependencies |

- hexok and ts-pf are peers, so the app and Lattice share one copy of each class and type ([0029](decisions/0029-hexok-and-ts-pf-are-peers.md)). An adapter's peer range on core is a caret range, never `*`. Every package publishes public.
- Each published package's `type-check` also checks its built declarations, as an app sees them through `exports`, with `skipLibCheck` off (`tsconfig.dist.json` over `dist-check/`). Root `skipLibCheck: true` once hid a declaration that failed for every app.
- npm does not check a workspace link against a peer range, so only a packed install catches a wrong internal range. Turbo ignores `peerDependencies` when ordering builds, so an adapter also lists core as a devDependency.
- Packages ship `dist` and `src` (no tests), so source maps resolve. They are MIT licensed. CI runs the four checks. Merging the Release workflow's "Version Packages" pull request publishes through npm trusted publishing: each package trusts `release.yml`'s `publish` job in the `npm` environment, through OIDC, with provenance. No npm token exists. The build runs in a separate job without `id-token`.
- Every `@ts-pf/*` package moves together on one version, ^1.0.0 today. `@latticecms/core` pins one ts-pf minor and one hexok major, and a bump is its own changeset.
- Tests that start a real server on MongoDB run one file at a time, in the crm's `servers` vitest project: each `start()` builds every index in a fresh database, and overlapping builds stall. Each package's mongodb-memory-server setup retries a start on a port collision. A secret value in a test that checks a JSON body has a fraction (`4242.5`), so no random hex id can contain it.
- The root README's Getting started is a script: `examples/walkthrough` packs the published packages at 0.1.0, installs the tarballs in an empty app, runs the README's bash blocks, writes its file blocks, starts the app and drives the admin in Chromium. A block it cannot classify fails it. It runs as its own CI job, and `npm run walkthrough` locally. `WALKTHROUGH_FROM=registry` runs it against npm.
- A package README is its docs page, as in hexok and ts-pf. `packages/docs` builds the site at crobinson42.github.io/lattice-cms from the READMEs, and the Pages workflow deploys it on every push to main, so it can show what main has and npm does not yet. Its home page is written by hand. Getting started and the package pages are generated at build time and gitignored. The sync rewrites a README's relative links (a package to its page, a Getting started anchor to that page, any other path to GitHub), and a link to a path not in the repository fails the build. A README code block whose first line names a file (`// packages/…` or `// examples/…`) must be a run of that file's lines; `examples/crm`'s `readme-quotes.test.ts` checks it. Core's quick start is a crm file that a test runs.
- No casts. Where a value built at runtime meets a precise type, one asserted overload states the precise type over an erased implementation. There are 8 in core: `build`, `contractOf`, `patchSchema`, `relationsOf`, `repo`, `sortSchema`, `tenantShapes` and `whereSchema`. Adding one needs a reason in review. Each Zod-typed overload states both of Zod's type parameters, or ts-pf callers get `unknown`.
- `rootRouter()` in `build.ts` calls ts-pf's `router()` through its runtime shape, and relies on `router()`'s runtime check of the whole tree (a test proves an incomplete tree throws). `ReadUseCase` names a populating read for declaration emit. Both work around ts-pf typing limits and go when ts-pf changes (proposed changes table).
- A constraint that any schema must meet, such as `FamilySpec` or `AnyRelation`, uses Zod core's `z.core.$ZodType`, and parses with `z.safeParse(schema, value)`. A concrete classic schema checked against classic `z.ZodType` compares about 60 members, which made each relation cost about 18k instantiations. `AnyCollection` still uses classic types: `Doc<C>` and the shape reads in `build.ts` need them. A method's schemas are classic.
- A compile error that Lattice raises is a `{ '~error': '…' }` property that names the problem. A key union in an error is wrapped in a template literal, so the message prints the union, not an alias.
- `@latticecms/core` ships an agent skill (`skills/lattice/`): a SKILL.md and one reference per concept, from collection to CLI, the way the `hexok` skill does. Its code blocks quote crm files, and `readme-quotes.test.ts` checks them.

## Phased build plan

Each phase ends at a gate; the next starts when its exit holds. Phase 0 builds the whole collection model on `MemoryStore` first, so the API shape is settled before any Mongo, auth or authz work. Durations are set when the previous phase lands.

| Phase | Scope | Exit |
| --- | --- | --- |
| 0. Kernel, in memory (done) | `collection()`, `family()`, `framework()`, `build()`, `MemoryStore`; generated CRUD use cases, contract slice, event classes; overrides, custom methods, family guards, logging | A three-collection example serves `/rpc` and all tests pass on `MemoryStore` |
| 1. Mongo, relations, access, tenancy (done) | `MongoStore`, `Where` translation, indexes, migrations runner; `ref()`, `many()`, join collections, batched population; `Access` port with default functions, row-level tenancy, `count` | `examples/crm` runs on Mongo; tenant isolation tests pass |
| 2. Production wiring (done) | `@hexok/auth` recipe, field masking; integration-events and webhooks recipes, a worker, MCP, OpenAPI; OpenTelemetry spans; CI and the release path. The `@hexok/authz` adapter waits for hexok | Core and store-mongo 0.1.0 are ready to publish; `examples/crm` is the reference app |
| 3. Admin and CLI (done) | Admin package that renders the served `catalog()` and `.meta()`, on `@shadalaya`; CLI scaffolding and migrations; the agent skill; a tested walkthrough; ts-pf 1.0. Uploads were deferred until an app needs files | The root README's Getting started reaches a signed-in admin with CRUD, as a CI job |
| 4. Hardening | Outbox relay, versions and drafts, Postgres store, index and performance tooling, security review; file uploads when an app needs them, on `@hexok/blob` | Ongoing; picked up as products need it |
