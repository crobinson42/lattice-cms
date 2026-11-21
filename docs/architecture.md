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

A collection is a declaration. At build time Lattice turns it into hexok use cases, a hexok event catalog and a ts-pf router slice ([0003](decisions/0003-collections-compile-at-runtime.md)). Nothing runs outside those primitives, so every generated piece can be replaced by a hand-written one with the same types.

### Define a collection

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
  access: {
    read: () => true,
    update: ({ actor }) => ({ authorId: { eq: actor.userId } }),
    delete: ({ actor }) => actor.roles.includes('admin'),
  },
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
- A collection may pass `entity: Post` instead of `schema`, where `Post extends Entity('Post', schema)`. Then domain rules live on the entity, the hexok way.
- `ref()` and `many()` are the only field helpers. Everything else is plain Zod.
- Only `z.object()`. Unknown keys are stripped. A loose object's index signature would reach every client type.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names.
- No `z.date()` and no transforms (`.transform()`, `.pipe()`, `z.preprocess`, codecs), anywhere in the schema. A Date reaches an HTTP client as a string, and a transform hides the field's kind from `Where`. Normalizing belongs in a `beforeChange` hook. `collection()` throws at definition time and, for top-level Dates, fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings, not `Date`. ts-pf sends JSON, so a `Date` would reach an HTTP client as a string while its type said `Date`.
- A collection names no use case classes. Methods and overrides attach where the app composes ([0018](decisions/0018-methods-and-overrides-attach-in-the-framework.md)).

### Compose and build

```ts
// app/use-cases/context.ts: the app's one use case family
export const AppUseCase = family({
  actor: actorSchema,                        // the app's actor, built by @hexok/auth at the edge
  actorId: (actor) => actor.userId,          // the id log lines carry
  tenantOf: (actor) => actor.organizationId,
})

// servers/app.ts
const lattice = framework({
  family: AppUseCase,
  store: new MongoStore({ db }), // CollectionStore adapter
  events: domainEvents,          // hexok Port over @hexok/queue
})
  .collection(Users)
  .collection(Posts, { methods: { publish: PublishPost }, overrides: { delete: ArchivePost } })
  .collection(Categories)

const { contract, app, useCases, repos } = lattice.build({
  methods: { posts: { publish: new PublishPost({ posts: lattice.repo(Posts), email }) } },
  overrides: { posts: { delete: new ArchivePost({ posts: lattice.repo(Posts) }) } },
})
```

- `.collection(C, { methods, overrides })` declares the classes. Their static schemas type the contract.
- `build()` takes one instance per declared class, keyed by slug and then name, the same shape as the contract.

| Output | What it is | Used by |
| --- | --- | --- |
| `contract` | A ts-pf `router` of every collection | Clients, `@ts-pf/openapi`, `@ts-pf/codegen`, the admin |
| `app` | The implemented ts-pf router | `FetchHandler`, `createLocalClient`, `@ts-pf/mcp` |
| `useCases` | hexok `UseCase` instances, such as `useCases.posts.create` | Workers, scripts, tests |
| `repos` | Typed `CollectionStore` views per collection, no access checks | Hand-written use cases and event handlers |

### What each collection generates

Every write returns the document: `create` and `update` the stored one, `delete` the one it removed.

- `create` sets `id` (a UUID), `createdAt` and `updatedAt`. Clients cannot set them.
- `update` is a partial patch. A patch never applies schema defaults, so an omitted field keeps its stored value. The merged document is validated with the whole schema, so an object-level `.refine()` holds on update as on create, and a stored key the schema no longer has is removed. Only changed fields and `updatedAt` are written. A stored document that no longer fits the schema fails `update` until a migration fixes it.
- `get`, `update` and `delete` on a missing or out-of-scope id throw `NOT_FOUND`.
- Each generated use case parses its own input, because hexok passes `execute` the raw value. The family guard has already rejected bad input.

- Use cases, in the app's one family: `posts.find`, `posts.get`, `posts.create`, `posts.update`, `posts.delete`, plus `posts.categories.list` and `posts.categories.set` for each `many()` relation.
- A contract slice: `posts.find`, `posts.get`, `posts.create`, `posts.update`, `posts.delete`, `posts.publish`, `posts.categories.*`.
- An event catalog: `posts.created`, `posts.updated`, `posts.deleted`.

### Custom methods and overrides

A custom method is a normal hexok use case in the app's one family ([0007](decisions/0007-one-use-case-family-per-app.md)). `family()` builds that family on hexok `UseCase.context`, so generated, overridden and custom use cases share one context type and one guard chain:

```ts
export class PublishPost extends AppUseCase('posts.publish', {
  collection: Posts,
  input: z.object({ id: z.string() }),
  output: Posts.output,
}) {
  constructor(private readonly deps: { posts: Repo<typeof Posts>; email: EmailSender }) { super() }
  async execute(ctx: UseCase.Ctx<typeof AppUseCase>, input: { id: string }) {
    /* load, change, save, publish an event */
  }
}
```

- The family guard runs access for the action `publish`, tenancy scoping and input validation before `execute`.
- The class's `collection` static and its token (`posts.publish`) must match where it is attached. `execute` must take the class's `input` schema output and return its `output` schema output.
- The app constructs the instance and passes it to `build()`, as hexok requires. `build()` is a type error when a declared method or override has no instance, the same completeness check as ts-pf `impl.router()`.
- `overrides: { delete: ArchivePost }` swaps one generated operation. The class must accept and return the generated operation's types, so clients see no change.
- Slugs and method names cannot be ts-pf implementer keys (`$context`, `use`, `useAfter`, `middleware`, `router`), and a method cannot reuse a generated operation's name.
- A method publishes its own events from a catalog the app owns. Generated catalogs cover CRUD only.

### Hooks

Collection hooks transform data and nothing else: `beforeChange` and `afterRead` ([0019](decisions/0019-hooks-are-before-change-and-after-read.md), proposed). They run inside the generated use cases, in this order: validate input (on update: read, merge, validate the merged document), `beforeChange`, store write, `afterRead` on every returned document. `beforeChange` receives `{ data, operation, previous? }`, where `data` is the whole document after the change on create and update alike. There is no `beforeValidate`: ts-pf validates input at the edge before any Lattice code runs. Business rules belong in an entity method or an override. Side-effects after a change are event handlers. Cross-cutting behavior (tracing, logging, timing) and error handling use the family's hexok `hooks()` and `onCatch`.

## Storage

Every collection talks to one hexok port, `CollectionStore`. MongoDB is the default adapter ([0002](decisions/0002-mongodb-is-the-default-store.md)). A collection can name its own store, so one app can keep collections on different clusters or regions.

```ts
abstract class CollectionStore extends Port('CollectionStore') {
  abstract ensure(collection: CollectionDef): Promise<void>           // indexes
  abstract find(q: FindQuery): Promise<Page<Doc>>                     // where, sort, limit, cursor
  abstract get(collection: string, id: string, where?: Where): Promise<Doc | null>
  abstract getMany(collection: string, ids: readonly string[], where?: Where): Promise<Doc[]>
  abstract insert(collection: string, doc: Doc): Promise<void>
  abstract update(collection: string, id: string, patch: Partial<Doc>, where?: Where): Promise<Doc | null>
  abstract remove(collection: string, id: string, where?: Where): Promise<Doc | null>
  abstract count(collection: string, where?: Where): Promise<number>
}
```

- `where` on `get`, `update` and `remove` carries the access and tenant filter, so a write never touches a row the caller cannot see.
- `getMany` exists for relation population. It is one query per collection per request.
- Adapters use a hexok `Mapper` per collection when the stored shape differs, such as `_id` for Mongo.
- `MemoryStore` ships in `@latticecms/core` for tests and examples, the way `@hexok/logger` ships `MemoryLogger`.

### Where filter

`Where<Doc>` is typed from the collection's document, system fields included. Each store translates it; nothing else reaches the database. A query on a field the schema does not have is a type error and a `VALIDATION` error at runtime.

| Field kind | Operators |
| --- | --- |
| string | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists` |
| number | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists` |
| boolean, enum (string or number literals) | `eq`, `ne`, `in`, `nin`, `exists` |
| array, object, anything else | `exists` |

- Several fields, or several operators on one field, all have to match. `and` and `or` take one or more filters and nest.
- Null and missing follow MongoDB's query semantics: `eq: null` matches null or missing, `ne` and `nin` match missing, and a comparison with null or missing is false. `exists` asks whether a field has a value, so null does not exist.
- Strings compare by code unit, so ISO timestamps order correctly. `contains` is a case-insensitive literal substring, never a regex.
- One operator table drives the type and the validator. A field's kind is decided from the values it accepts, the same way on both sides, and a table test checks every Zod field form.
- The generated `find` takes `where`, and ts-pf validates it with the same schema.

Pagination is cursor-based ([0008](decisions/0008-cursor-pagination.md)): `limit` + `after`, ordered by the `sort` fields plus `id`.

- `sort` is an array such as `['-createdAt', 'title']`, not an object, because Zod rebuilds object keys in shape order and would reorder the priority. Only required, non-null string, number and enum fields sort, so a cursor never meets null. The default is `['-createdAt']`; `id` is always the last tiebreak.
- `limit` is 1 to 100, default 20. The generated `find` applies the defaults, not the contract schema: ts-pf types client input from a schema's output, so a Zod default would make the field required for clients.
- A cursor is opaque base64url JSON of the sort and the last document's sort values. A cursor from another sort, or a malformed one, is `VALIDATION`. It is not signed: a forged cursor only moves the page start, and `where` still applies.
- The keyset predicate is itself a `Where` (`or` of `eq`/`gt`/`lt` clauses), so a store applies it as it applies any filter and has no pagination code of its own. Pass `withTotal: true` to also get `total`; it costs a second `count` query, so admin tables ask for it and APIs usually don't. Page numbers are not offered, because skip-based pages slow down on large Mongo collections.

### Indexes and migrations

- Indexes are declared on the collection. `ensure()` creates missing ones at startup and never drops one.
- Data migrations are numbered TypeScript files run by the CLI. A `_migrations` collection records what ran. A Redis lock from `@hexok/schedule-coordinator-redis` stops two processes running them at once.
- There is no schema migration step for Mongo. A breaking field change is a data migration.

## Relations

Relations are IDs plus explicit join collections ([0004](decisions/0004-no-database-joins.md)). The database never joins, so two related collections can sit in different stores, clusters or regions.

| Kind | Declared with | Stored as |
| --- | --- | --- |
| Belongs to one | `authorId: ref('users')` | An ID field on the child |
| Many to many, or one to many with metadata | `many('categories', { through, fields })` | A join collection, such as `post_categories`, with `postsId`, `categoriesId` and the `fields` |
| A short ordered list with no metadata | `tagIds: z.array(ref('tags'))` | An ID array on the parent, capped by the schema's `max()` |

Join collections are real collections. They get generated use cases, access, tenancy, indexes and events. Their default access is the parent's `update` access.

### Population

- A read takes `populate: ['authorId', 'categories']`, one level deep in v1.
- Lattice collects IDs per target collection and calls `getMany` once each. Access and tenancy filters apply to the populated documents too.
- A populated document the caller may not read comes back as `{ id }` only.
- Output types follow `populate`: `authorId` is a `string`, or a `User` when populated.

### Deleting a parent

Each `ref()` and `many()` declares `onDelete`: `restrict` (default), `cascade` or `nullify`.

- Same store: the generated delete use case does the work in one Mongo transaction when the deployment is a replica set, otherwise in order with the parent last.
- Different stores: `restrict` is checked before the delete; `cascade` and `nullify` run in an event handler on `<parent>.deleted`. They are eventually consistent and must be idempotent.

## Auth, access and tenancy

Authentication stays in `@hexok/auth` at the edge ([0006](decisions/0006-use-cases-receive-the-actor.md)). Lattice sees only the app's actor, checks access in a family guard, and scopes every query to the actor's tenant.

### Authentication

The app follows hexok's `app-template` pattern unchanged. A ts-pf context function reads the credential, `Sessions` or `resolving()` turns it into the actor, and the actor goes on the use case context. Lattice validates the actor against the family's actor schema and never imports `@hexok/auth`. Swapping to the company IdP changes the composition root only.

### Access

Access is a hexok port, so the decision engine can be replaced:

```ts
abstract class Access extends Port('Access') {
  abstract check(args: {
    actor: Actor
    collection: string
    action: 'find' | 'get' | 'create' | 'update' | 'delete' | (string & {})  // custom methods too
    data?: unknown       // create / update input
  }): Promise<boolean | Where>
}
```

- Access is a filter in the query ([0005](decisions/0005-access-and-tenancy-are-query-filters.md)).
- The default adapter reads each collection's `access` functions, Payload style. A missing function denies.
- A `Where` result is merged into the query (`find`) or the write's `where` (`get`, `update`, `delete`). Access is never checked by loading a row and then deciding.
- `false` throws one `FORBIDDEN` error. A row outside a `Where` is `NOT_FOUND`, so callers cannot probe for IDs.
- When `@hexok/authz` ships, it becomes an adapter of this port. Its list checks must return a filter, not only a yes or no.
- Field-level read masking (`fields: { salary: { read } }`) is Phase 2.

### Tenancy

Row-level tenancy is the only built-in strategy ([0009](decisions/0009-strict-tenant-isolation-in-v1.md)). It covers the team's organization model.

- `family({ actor, tenantOf: (actor) => actor.organizationId })` names the actor's active organization. The edge picks it, from the session or a header, as the app already does.
- A collection with `tenant: 'organizationId'` gets that field stamped on create and added to every filter. Clients cannot set or change it.
- Join collections inherit the parent's tenant field.
- A collection without `tenant` is global, such as a lookup table.
- No cross-tenant sharing in v1. The tenant filter is one clause that the `Access` port can widen later (own organization OR shared to me), so `@hexok/authz` adds sharing without changing collections.
- `tenancy.bypass(actor)` lets a platform actor (support staff, GodMode) read across tenants. Every bypassed call is logged with the actor and collection.
- Generated events carry `tenantId` in their payload.

Schema-per-tenant and database-per-tenant are possible by routing a collection's `store` per tenant. They are not built in v1.

## Events and side-effects

Events are hexok's event model plus the queue and broadcast ports ([0010](decisions/0010-collection-events-stay-in-the-product.md), [0011](decisions/0011-no-read-events.md)). Use cases publish events after a successful write; event handlers do the side-effects in the worker.

- `collection()` derives three hexok `Event` classes from the schema: `Posts.events.created`, `.updated` and `.deleted`, with tokens `posts.created`, `posts.updated` and `posts.deleted`. Payloads are `{ doc, previous?, tenantId, actorId }`, typed from the schema. They hold no use case references, so the collection stays a pure declaration ([0020](decisions/0020-collection-events-join-the-app-catalog.md), proposed).
- Events publish after the store write succeeds, with `doc` as stored (before `afterRead`). A publish failure reaches the caller although the write happened: the delivery gap below. Overrides and methods publish their own events; Lattice publishes nothing for them.
- `actorId` is the family's `actorId` option, which the family exposes (`AppUseCase.actorId(ctx.actor)`), so log lines and events read one function.
- The app lists them in its own one catalog, next to its hand-written events. Its existing `DomainEventPublisher` and queue adapter then publish them unchanged. `.collection(C)` is a compile error when the publisher passed to `framework({ events })` cannot take `C`'s events. `events` is required; an app with no subscribers passes a no-op publisher.

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

One generated contract serves every surface. Lattice writes no transport code.

```ts
const handler = new FetchHandler(app, {
  prefix: '/rpc',
  context: async (req) => ({
    actor: await actorFrom(req),                       // @hexok/auth at the edge
    logger: logger.child({ requestId: req.headers.get('x-request-id') }),
  }),
})
serve({ fetch: handler.fetch })                       // srvx; or Hono, Bun, Next, Astro

const local = createLocalClient(app, { context: { actor, logger } }) // in-process, same guards and errors
await local.posts.find({ where: { status: { eq: 'published' } }, limit: 20 })
```

| Surface | Package | Notes |
| --- | --- | --- |
| HTTP (POST JSON RPC) | `@ts-pf/server-http` | `POST /rpc/posts/find`. Cacheable GET reads use the userland bridge ts-pf already documents |
| In-process | `@ts-pf/server` `createLocalClient`, or `useCases.*` | Tests, scripts, server-rendered pages. Same guards and errors |
| WebSocket, stdio | `@ts-pf/message-server` | For live admin or CLI tools |
| MCP | `@ts-pf/mcp` | Each collection operation becomes a tool. Large apps use tool hosts |
| OpenAPI | `@ts-pf/openapi` | `profile: 'codegen'` for Dart, Swift and Kotlin clients |
| TypeScript clients | `@ts-pf/client` + `client-http`, `@ts-pf/swr`, `@ts-pf/mvc-kit` | Import `contract` only, never server code |
| Split repos | `@ts-pf/codegen` | `.d.ts` from the catalog, plus a breaking-change check in CI |

Errors are a hexok `Errors` catalog mapped once to ts-pf declared errors (`UNAUTHORIZED`, `NOT_FOUND`, `FORBIDDEN`, `CONFLICT`, `VALIDATION`), as `app-template`'s `rpc/errors.ts` does. Every generated procedure declares the same set.

REST with path parameters is not offered. If an outside partner needs it, it is a projection plus an executor beside `FetchHandler`, the way ts-pf already plans one.

## Observability

Every generated operation logs and times itself through the family's hexok `hooks()`, with no code in the collection.

- Logging: the call context carries a `@hexok/logger` `Logger`. The edge passes `rootLogger.child({ requestId })`; workers, scripts and tests pass their own. The family's hooks log each call through a child with `actorId`, `tenantId`, `collection`, `action` and `durationMs`. A context logger, not one given to `framework()` or `family()`, because family hooks are fixed when the family is created and see only the call, and because no module has to import a configured logger at load time. Sentry and New Relic attach through `TeeLogger`, as in `app-template`.
- One line per call that passes the guards: `info` with `outcome: 'ok'` on return; `info` with `outcome: 'refused'`, `catalog` and `code` for a member of any hexok `Errors` catalog; `error` with the stack for anything else.
- Guards run outside hexok hooks, so a rejected actor or input is not logged by the family. The edge logs it.
- Errors: `onCatch` logs unexpected errors once. ts-pf's `onError` is set so the same error is not logged twice.
- Tracing (Phase 2): one span per procedure (ts-pf server call interceptor), one per use case (`preExecute` / `onFinally`), one per store call (inside the adapter). Spans use `@opentelemetry/api` and follow OpenTelemetry names.
- Tests: `MemoryLogger` and a no-op tracer, so assertions can read what was logged.

## Proposed changes to hexok and ts-pf

Phases 0 and 1 need no change to either library. The items below are later needs. Each goes through hexok's scope gate or ts-pf's `DECISIONS.md` process before it lands; this table is the input to that discussion, not approval.

| Item | Where | Needed by | Recommendation | Why |
| --- | --- | --- | --- | --- |
| `@hexok/authz` | hexok (already planned) | Phase 2 | Build it; add list checks that return a filter | Every product needs it. Lattice adapts its `Access` port to it |
| Tracing port | hexok | Phase 2 | No new package. Lattice calls `@opentelemetry/api` directly | The OTel API is already vendor-neutral and a no-op without an SDK, so an app can solve this today (gate question 2) |
| Blob storage port, `@hexok/blob` + `@hexok/blob-s3` | hexok | Phase 3 | Build it, shaped like `email` / `sms` | Any product with uploads needs it. S3 covers DigitalOcean Spaces |
| Mongo client lifecycle | `@latticecms/store-mongo` | Phase 1 | Keep it in Lattice | Only the store uses it. Move to hexok when a second package needs it, the way `ioredis-lifecycle` was extracted |
| Outbox relay | `@latticecms/store-mongo` | Phase 4 | Keep it in Lattice | It is Mongo-specific. `@hexok/integration-events` already accepts a stable `id` |
| Middleware context narrowing | ts-pf (`Q4`, deferred to v2) | Nice to have | Wait for ts-pf v2 | Generated routers can declare the actor key up front, as ts-pf documents today |
| Admin metadata on procedures | ts-pf | Phase 3 | No change | Procedure `.meta()` already flows into `catalog()` |

## Repository and packages

The repo copies hexok and ts-pf tooling: npm workspaces, Turbo, Biome, Changesets, Vitest, TypeScript 6, Node 22+, ESM only, strict `tsconfig` with `exactOptionalPropertyTypes` and `noUncheckedIndexedAccess`. Start with one package and add one only when a phase needs it.

```
packages/
  core/            @latticecms/core            collection(), ref(), many(), Where, family(), framework(),
                                               build(), CollectionStore + Access ports, MemoryStore
  store-mongo/     @latticecms/store-mongo     MongoStore, Mongo mappers, migrations runner (Phase 1)
  admin/           @latticecms/admin           React admin on @shadalaya + @ts-pf/client (Phase 3)
  cli/             @latticecms/cli             scaffold collection, run migrations (Phase 3)
  store-postgres/  @latticecms/store-postgres  (Phase 4)
examples/
  crm/             HTTP process + worker, shaped like hexok's app-template
```

| Package | Depends on | Peer |
| --- | --- | --- |
| `@latticecms/core` | `hexok`, `@ts-pf/contract`, `@ts-pf/server`, `@ts-pf/protocol` | `zod` 4 |
| `@latticecms/store-mongo` | `@latticecms/core`, `hexok` | `mongodb` |
| `@latticecms/admin` | `@ts-pf/client`, `@ts-pf/client-http`, `@ts-pf/docs` | `react`, `@shadalaya/react` |

- Every `@ts-pf/*` package moves together on one version. `@latticecms/core` pins one ts-pf minor and one hexok major, and a bump is its own changeset.
- A package README is its docs page, as in hexok and ts-pf.
- `@latticecms/core` ships an agent skill (`skills/lattice/`) that walks a feature from collection to override, the way the `hexok` skill does. Phase 3.

## Phased build plan

Each phase ends at a gate; the next starts when its exit holds. Phase 0 builds the whole collection model on `MemoryStore` first, so the API shape is settled before any Mongo, auth or authz work. Durations are set when the previous phase lands.

| Phase | Scope | Exit |
| --- | --- | --- |
| 0. Kernel, in memory ([plan](plans/phase-0.md)) | `collection()`, `family()`, `framework()`, `build()`, `MemoryStore`; generated CRUD use cases, contract slice, event catalogs; overrides, custom methods, family guards, logging | A three-collection example serves `/rpc` and all tests pass on `MemoryStore` |
| 1. Mongo, relations, access, tenancy | `MongoStore`, `Where` translation, indexes, migrations runner; `ref()`, `many()`, join collections, batched population; `Access` port with default functions, row-level tenancy, `withTotal` | `examples/crm` runs on Mongo; tenant isolation tests pass |
| 2. Production wiring | `@hexok/auth` recipe, `@hexok/authz` adapter, field masking; integration-events and webhooks recipes, MCP, OpenAPI; OpenTelemetry spans | One internal tool runs in production on Lattice |
| 3. Admin and CLI | Admin SPA from `catalog()` and `.meta()`, on `@shadalaya`; CLI scaffolding and migrations; uploads through `@ts-pf/file` and a blob port | A new tool reaches CRUD, auth and admin in under one day |
| 4. Hardening | Outbox relay, versions and drafts, Postgres store, index and performance tooling, security review | Ongoing; picked up as products need it |
