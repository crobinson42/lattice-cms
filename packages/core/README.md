# @latticecms/core

Collections that compile into hexok use cases, hexok event classes and a ts-pf contract. A collection is a Zod schema with a slug. `framework()` turns a set of them into a typed RPC contract, and `build()` wires that contract to a store and an event publisher. Lattice builds on [hexok](https://www.npmjs.com/package/hexok) and [ts-pf](https://www.npmjs.com/package/@ts-pf/server) rather than replacing them: every generated piece is a real hexok `UseCase`, `Event`, `Errors`, `Port` and ts-pf `router`, so a hand-written one can take its place with the same types.

Status: unpublished, before 1.0. The design and the reasons behind it are in [docs/architecture.md](../../docs/architecture.md).

## Install

```sh
npm install @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server zod @hexok/logger
```

`hexok` 2, `@ts-pf/*` 0.6, `zod` 4 and `@hexok/logger` 0.2 are peer dependencies. The app installs them, so it and Lattice share one copy, and a `UseCase` or `Port` the app imports is the same class Lattice built. Serve the result with `@ts-pf/server-http`, and call it with `@ts-pf/client`.

## Example

From [`examples/crm`](../../examples/crm): three tenanted collections on MongoDB, one override, one custom method and one app error, served at `/rpc`.

A collection is a slug and a `z.object()` schema. Hooks transform data and nothing else.

```ts
// examples/crm/src/domain/collections/contacts.ts
import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.email(),
    // A company with contacts cannot be deleted: restrict, the default.
    companyId: ref('companies'),
  }),
  tenant: 'organizationId',
}).hooks({
  // One spelling per address, so a where on email finds it.
  beforeChange: ({ data }) => ({ ...data, email: data.email.toLowerCase() }),
});
```

The app has one use case family. Generated and hand-written use cases extend it, and share its guards and logging. `tenantOf` gives each call its organization.

```ts
// examples/crm/src/app/use-cases/context.ts
import { family, tenancy } from '@latticecms/core';
import type { UseCase } from 'hexok';
import { z } from 'zod';

/** Who is calling. The edge builds it; real auth arrives in Phase 2. */
export const actorSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Support staff read every organization's rows, and change none. */
  support: z.boolean().optional(),
});

/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

export type AppCtx = UseCase.Ctx<typeof AppUseCase>;
```

The definition holds no ports, so a client or a codegen script imports `contract` without the server.

```ts
// examples/crm/src/servers/rpc/contract.ts
import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { ArchiveDeal } from '../../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../../app/use-cases/deals/close-deal.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { Deals } from '../../domain/collections/deals.js';
import { clientErrors, toRpcError } from './errors.js';

/** Any signed-in caller may do this. The edge has already checked the actor. */
const anyone = () => true;

// An archived deal is hidden from every read and can no longer change.
const live = () => ({ archived: { eq: false } });

/** The CRM's API: three collections, one override and one method. No ports. */
export const crm = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError },
})
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Deals, {
    access: {
      read: live,
      create: anyone,
      update: live,
      delete: live,
      close: live,
    },
    methods: { close: CloseDeal },
    overrides: { delete: ArchiveDeal },
  });

/** What clients and codegen import. */
export const contract = crm.contract;

export { AppUseCase, Companies, Contacts, Deals };
```

`build()` wires the definition to a store and a publisher. The method and override instances get the typed repos.

```ts
// examples/crm/src/servers/app.ts
import type { CollectionStore } from '@latticecms/core';
import type { DomainEventPublisher } from '../app/ports/events/domain-event-publisher.js';
import { ArchiveDeal } from '../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../app/use-cases/deals/close-deal.js';
import { crm } from './rpc/contract.js';

export type AppPorts = {
  readonly store: CollectionStore;
  readonly events: DomainEventPublisher;
};

/** The implemented router, use cases and repos over these ports. */
export function createApp({ store, events }: AppPorts) {
  return crm.build({
    store,
    events,
    methods: ({ repos }) => ({
      deals: { close: new CloseDeal({ deals: repos.deals, events }) },
    }),
    overrides: ({ repos }) => ({
      deals: { delete: new ArchiveDeal({ deals: repos.deals }) },
    }),
  });
}

export type CrmApp = ReturnType<typeof createApp>;
```

The server starts the store, runs the migrations, creates the indexes, then serves:

```ts
// examples/crm/src/servers/http/main.ts
const store = new MongoStore({ url, database: process.env.MONGODB_DATABASE ?? 'crm' });
const crm = createApp({ store, events: new LoggingDomainEventPublisher({ logger }) });

await store.start();
await migrate(store, migrations, { logger });
await crm.ensure();
```

ts-pf's `FetchHandler` serves the app. `onError` from `build()` logs what the family did not.

```ts
// examples/crm/src/servers/http/handler.ts
export function createHttpHandler(
  crm: Pick<CrmApp, 'app' | 'onError'>,
  options: { logger: Logger },
): (request: Request) => Promise<Response> {
  // Logs what no family logged: a family logs its own unexpected errors.
  const handler = new FetchHandler(crm.app, {
    onError: crm.onError(options.logger),
  });
  const context = contextOf(options.logger);
  return async (request) => {
    const result = await handler.handle(request, { prefix: '/rpc', context });
    if (result.matched) return result.response;
    return new Response('Not Found', { status: 404 });
  };
}
```

A client needs no annotations. Input, output and declared errors come from the contract, so the client narrows on the app's `AlreadyClosed` and its `data`.

```ts
// examples/crm/src/servers/app.test.ts
const deal = await local.deals.create({
  title: 'Big one',
  companyId: 'c1',
  amount: 1000,
});

const won = await local.deals.close({ id: deal.id, outcome: 'won' });
expect(won).toMatchObject({ stage: 'won', closedAt: expect.any(String) });

const again = await asResult(
  local.deals.close({ id: deal.id, outcome: 'lost' }),
);
if (again.ok) throw new Error('expected AlreadyClosed');
if (again.error.code !== 'AlreadyClosed') throw new Error(again.error.code);
expectTypeOf(again.error.data).toEqualTypeOf<{ id: string }>();
expect(again.error.data).toEqual({ id: deal.id });
expect(again.error.status).toBe(409);
```

## Reference

### `collection(slug, { schema, tenant?, indexes?, relations? })`

Returns a `Collection` with `slug`, `schema`, `tenant`, `indexes`, `output`, `events` and `hooks()`. `output` is the stored document's schema: the collection's schema plus `id`, `createdAt`, `updatedAt` and the tenant field.

- `schema` is a `z.object()`. Unknown keys are stripped.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names.
- No `z.date()` and no transforms, anywhere in the schema. Store ISO strings (`z.iso.datetime()`). Normalize in a `beforeChange` hook. `collection()` throws at definition time, and a top-level Date or reserved name fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings.
- `tenant: 'organizationId'` makes the collection tenanted; see [Tenancy](#tenancy). Without it, the collection is global.
- A field name may not contain `.`, start with `$`, or be `_id`: MongoDB would read it as a path, an operator or the id.
- `indexes` lists the indexes the store creates at startup, through `build().ensure()`: `[{ fields: { stage: 1, createdAt: -1 } }, { fields: { email: 1 }, unique: true }]`. Fields are named from the stored document, so the system fields and the tenant field count; any other name is a compile error and a throw. Key order is the index's order. `id` needs no index. A tenanted collection's indexes usually lead with the tenant field, because every call filters by it; Lattice does not add it for you.

### Refs and `onDelete`

`ref(slug, { onDelete? })` marks a string field as the id of a document in another collection. It names the collection by its slug, so two collections can refer to each other. `z.array(ref(slug))` is a list of ids.

```ts
const Projects = collection('projects', {
  schema: z.object({
    name: z.string(),
    companyId: ref('companies', { onDelete: 'cascade' }),
    reviewerId: ref('users', { onDelete: 'nullify' }).optional(),
  }),
  tenant: 'organizationId',
});
```

- A ref is a string: Zod's methods work on it, and `ref('users').min(1).optional()` is still a ref.
- A slug that is not a collection of the framework is a compile error and a throw at `build()`, and on `.contract`. Collections may be added in any order.
- A write does not check that the referenced document exists. Deleting it is where refs are kept whole.
- Each ref gets an index in `ensure()`, led by the tenant field, unless the collection declares one with the same keys.

`onDelete` says what the generated delete of the referenced document does to the documents that refer to it:

| `onDelete` | When a referenced document is deleted |
| --- | --- |
| `restrict` (default) | The delete is refused with `REFERENCED` (409), `{ collection, id, by: { collection, field } }`, while any document refers to it |
| `cascade` | The referring documents are deleted too, and their own refs are followed in turn. A cycle stops at a document already deleted. A list of ids cannot cascade |
| `nullify` | The ref is cleared: an optional field is removed, a nullable one set to null, and the id pulled from a list. A required ref cannot nullify |

- These are system steps: they skip access functions, because the caller was allowed to delete the parent. They stay inside the parent's tenant, so another tenant's row that stores this id is neither counted nor touched. A global parent's children are found across tenants.
- Everything runs in one `store.transaction()`, with the parent deleted last. Restrict is checked before anything is written. Each cascaded document emits its `deleted` event and each nullified one its `updated` event, after the commit, never inside it. A failure rolls the whole delete back, and nothing is published.
- A collection that overrides `delete` cannot have a cascading ref: the cascade would hard-delete rows its override keeps, such as soft-deleted deals. It is a compile error and a throw at `.collection()`; use `restrict` or `nullify`.
- `onDelete` runs in the generated delete only. An override of `delete`, such as a soft delete, keeps the row, so its children stay valid; an override that removes rows handles their refs itself. `Repo.remove` is trusted and does not run it.

### `many()` relations

`many(target, { through, fields?, onDelete? })` relates each document to many of another collection, through a join collection Lattice derives:

```ts
const Posts = collection('posts', {
  schema: z.object({ title: z.string() }),
  tenant: 'organizationId',
  relations: {
    categories: many('categories', {
      through: 'post_categories',
      fields: z.object({ sortOrder: z.number().int().default(0) }),
    }),
  },
});
```

- The join collection is `Posts.relations.categories.through`, with slug `through`. Its documents are `{ postsId, categoriesId, ...fields }` plus the system fields and the parent's tenant field. `postsId` cascades from the post; `categoriesId` takes `onDelete` (`restrict` by default, or `cascade`). It has its own events, which the app lists in its catalog like any collection's, and it is in `repos` (`repos.post_categories`), but it has no slice: links change only through `set`.
- It gets a unique index on the pair, and one on `categoriesId`, both led by the tenant field.
- `posts.categories.list({ id, where?, sort?, limit?, after? })` pages the post's links, with find's `where`, `sort` and cursor over the link documents. It runs the post's `read` access: a post outside it is `NOT_FOUND`.
- `posts.categories.set({ id, links })` replaces the post's links: each link is `{ categoriesId, ...fields }`, at most 1000, and a target repeated is `VALIDATION`. It runs the post's `update` access. It diffs, in one `store.transaction()`: links no longer listed are deleted, new ones inserted, and changed fields updated; an unchanged link keeps its id and `createdAt`. Each change emits its own join event, after the commit. It returns the links in the order given. A tenant bypass cannot set.
- Both are use cases in the family (`useCases.posts.categories.set`), and can be overridden: `overrides: { categories: { set: ReorderCategories } }`.
- A relation name may not be a schema field, an operation, `read`, a method or a ts-pf implementer key, and `through` may not be another collection's slug. A collection cannot relate to itself with `many()`. A link field may not be named like the two ref fields, a reserved name or the tenant field. Method names may not contain a dot. Each is a compile error and a throw.

### Population

A read takes `populate`, a list of what to replace with documents. The output type follows the list on every ts-pf client, and on `useCases`, through ts-pf's expandable outputs:

```ts
// examples/crm/src/servers/app.test.ts
const got = await local.contacts.get({
  id: ada.id,
  populate: ['companyId'],
});

expectTypeOf(got.companyId).toEqualTypeOf<
  Doc<typeof Companies> | Withheld
>();
```

With the `Posts` above, and an `authorId` ref to `users`:

```ts
const post = await client.posts.get({ id, populate: ['authorId', 'categories'] });
post.authorId; // Doc<typeof Users> | Withheld
post.categories; // { sortOrder: number; doc: Doc<typeof Categories> | Withheld }[]
const plain = await client.posts.get({ id });
plain.authorId; // string
const page = await client.posts.find({ populate: ['authorId'] });
const links = await client.posts.categories.list({ id, populate: ['categoriesId'] });
```

- `get` populates ref fields and `many()` relations. `find` populates ref fields only, so one page cannot fetch up to 1000 links per document; a relation on `find` is a compile error and `VALIDATION`. A relation's `list` populates its links' refs, which is how a page of links gets its documents.
- A ref populates as the target document. A list of ids populates element-wise. A nullable or optional ref keeps its `null` or `undefined`. A relation populates as its links, each `{ ...fields, doc }`, and is in the output only when populated.
- A populated document the caller may not read, or one that no longer exists, is `Withheld`: `{ id }` only. Narrow with a field: `'email' in post.authorId`.
- Each target collection is read once per call, with `getMany`, for all the documents and fields that refer to it. It runs under the caller's `read` access there, which carries the tenant, and through its `afterRead`. A relation's links are read in one `find` on the join collection, inside the parent's tenant, under the parent's `read`.
- A `read: false` on a target does not fail the read: every document of that target is `{ id }`.
- One level deep: a populated document's own refs stay ids.
- A `populate` list held in a `K[]` variable gives the wide type, where each ref is the id or the document, because it could hold any subset.
- An overridden `get`, `find` or `list` is plain: it takes no `populate`, because the override serves it and population runs in the generated read.

### Hooks

`.hooks({ beforeChange?, afterRead? })` returns the same collection with those hooks. A later call replaces a hook it names.

- `beforeChange({ data, operation, previous? })` runs after validation, before the write, on create and update. `data` is the whole document after the change, without system fields. It returns the data to store.
- `afterRead({ doc })` runs on every document a generated operation returns. It does not change what is stored or what events carry.

### `family({ actor, actorId, tenantOf? })`

Builds the app's one hexok `UseCase.context` family. A caller passes `{ actor, logger }` (`CallContext<Actor>`): the actor, and a `@hexok/logger` `Logger` for the call. Lattice adds `access`, the call's access, so a use case receives `{ actor, logger, access }` (`FamilyContext<Actor>`).

- Before `execute`, the actor must parse against `actor`, the input against the use case's `input` static, and access must allow the use case's action. A bad actor is `UNAUTHORIZED`, bad input is `VALIDATION`, and a refusal is `FORBIDDEN`.
- `actorId` names the id that log lines and collection events carry. The family exposes `actor`, `actorId` and `tenantOf`, so hand-written code calls `AppUseCase.actorId(ctx.actor)`.
- `tenantOf` names the actor's tenant id, or `tenancy.bypass`. A framework with a tenanted collection requires it; see [Tenancy](#tenancy).
- Every call writes one line through a child of `ctx.logger` with `collection`, `action`, `actorId`, `tenantId` (or `tenancy: 'bypass'`), `outcome` and `durationMs`.
- A hand-written use case extends the family with a `collection` static, and `input` and `output` schemas for a method. Its token is `<slug>.<name>`.

`FamilyContext<Actor>` is the context type a use case receives, and `CallContext<Actor>` the one a caller passes. `Family<Actor, Tenanted>` is the family's type; `Tenanted` is true when it has `tenantOf`.

### `framework()`, `.collection()` and `build()`

`framework({ family, errors? })` starts a definition. `errors` is the app's `{ declared, map }`; an app with no domain errors leaves it out.

`.collection(C, { access, methods?, overrides? })` adds a collection. Its slug becomes a contract slice with `find`, `count`, `get`, `create`, `update` and `delete`. `access` is required; see [Access](#access).

- `methods: { name: Class }` adds a procedure. `overrides: { action: Class }` replaces a generated one.
- Each class must name `C` and its token, and its `execute` must take and return the procedure's types. A mismatch, a reserved name, or a slug added twice is a compile error and a runtime throw.

`.contract` is the ts-pf contract, built once on first read. `Contract<E, D>` is its type.

`build({ store, events, access?, methods?, overrides? })` wires the definition and returns:

| Output | What it is |
| --- | --- |
| `app` | The implemented ts-pf router, for `FetchHandler` and `createLocalClient` |
| `useCases` | The hexok instance that serves each procedure: generated, override or method, each typed precisely |
| `repos` | A `Repo<C>` per collection: the objects the factories received |
| `onError` | `onError(logger)` for `FetchHandler` |
| `context` | `context({ actor, logger })`: the context for a direct `useCases.*.execute` call |
| `ensure` | `ensure()`: creates each collection's declared indexes, in definition order, and never drops one |

- `methods` and `overrides` are factories, `({ repos }) => instances`, keyed by slug and then name. Each is required exactly when a collection declared one.
- `access` replaces the functions given at `.collection()` with another `Access` adapter.
- `app` adds a fresh `access` to each call's context. A direct caller gets one from `context()`. Access answers are kept on the context, so make one per call or per job.
- `events` must take every collection's events. One that cannot is a compile error that names each refused token.
- Await `ensure()` after the store has started and before serving, as the CRM's [`main.ts`](#example) does.
- `Framework<Actor, D, E, Tenanted>` is the definition's type.

### Access

Access decides what a call may see and change. It is a filter in the query: Lattice never loads a row and then decides whether the caller may see it.

`.collection(C, { access })` takes one function per action: `read` (find, count and get), `create`, `update`, `delete`, and one per method.

- Each function receives `{ actor }`, typed by the family's actor schema. `create` also receives `data`, its parsed input.
- `read`, `update`, `delete` and a method return `boolean` or a `Where` on `C`'s documents, or a promise of one. `create` returns `boolean`.
- `true` allows every row. `false` refuses the call with `FORBIDDEN`. A `Where` limits the call to the rows that match: a row outside it is `NOT_FOUND` on get, update and delete, and `find` never returns it.
- A missing function denies. `access: {}` denies everything. An override uses the function of the action it replaces.
- A `Where` on a field `C` lacks, a key that is not an action or a method, and a method with no function are compile errors.
- An access `Where` is ANDed with the caller's `where`, so a caller can only narrow it.

A family guard checks access before every `execute`: generated operations, overrides and methods. The refusal is logged once. Each function runs once per call.

A hand-written use case gets its filter with `ctx.access.scope(C, action)`, and passes the `Scope` to its repo calls. It may ask for another collection's scope too, such as `ctx.access.scope(Posts, 'find')`.

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
const scope = await ctx.access.scope(Deals, 'close');
const deal = await this.deps.deals.get(input.id, scope);
```

Hide rows with a `read` filter, such as soft-deleted ones. The CRM's `live` filter above hides an archived deal from `find` and `get`, and keeps it from changing.

`Access` is the hexok port behind this. `build({ access })` takes another adapter of it. Its `check({ actor, collection, action, data? })` returns `boolean` or a `Where`; `action` is `find`, `count`, `get`, `create`, `update`, `delete` or a method's name, and `data` is passed for `create` only.

### Tenancy

A collection with `tenant: 'organizationId'` keeps each tenant's rows apart. Lattice adds the field to the output, stamps it on create, and filters every call by the caller's tenant. A collection without `tenant` is global: no call is filtered by tenant.

```ts
const AppUseCase = family({
  actor: z.object({ userId: z.string(), organizationId: z.string(), support: z.boolean().optional() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => (actor.support === true ? tenancy.bypass : actor.organizationId),
});

const Notes = collection('notes', {
  schema: z.object({ title: z.string() }),
  tenant: 'organizationId',
});
```

- `family({ tenantOf })` gives each call's tenant. A tenanted collection in a framework whose family has no `tenantOf` is a compile error and a throw.
- The tenant field is in `Doc` and `Where`, never in create or update input. Create stamps it after `beforeChange`, update never writes it, and a client cannot set or change it.
- Every scope is the tenant clause ANDed with the access `Where`. Another tenant's row is `NOT_FOUND` on get, update and delete, and `find` never returns it, page after page.
- A schema field with the tenant's name, or a reserved name, is a compile error and a throw.

`tenancy.bypass` is what `tenantOf` returns for a platform actor, such as support staff. The actor schema validates the flag, and the edge sets it per request.

- A bypassed call reads across tenants. It can filter `find` by the tenant field.
- It is read-only on tenanted collections: generated create, update and delete are `FORBIDDEN`, and so is a repo write through its scope.
- Its log line carries `tenancy: 'bypass'`, and each bypassed scope writes one `tenancy.bypass` line with the actor, collection and action.

Server code says which tenant it works in. An event handler uses `tenancy.scope(C, tenantId)`: the tenant clause and no access. An insert through it is stamped with that tenant. `tenancy.scope` takes only a tenanted collection.

```ts
await repos.notes.update(id, patch, tenancy.scope(Notes, event.payload.tenantId));
```

`unscoped` still reads and writes every tenant, but it cannot insert into a tenanted collection, since the row would belong to no tenant. That is a compile error and a throw.

### `Where` and `Sort`

`find` takes `{ where?, sort?, limit?, after? }` and returns `{ docs, next }`. `Where<Doc>` and `Sort<Doc>` are typed from the document, system fields included.

| Field kind | Operators |
| --- | --- |
| string | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `contains`, `exists` |
| number | `eq`, `ne`, `in`, `nin`, `gt`, `gte`, `lt`, `lte`, `exists` |
| boolean, enum | `eq`, `ne`, `in`, `nin`, `exists` |
| array of strings, numbers or enum values | `has`, `exists` |
| array of anything else, object, anything else | `exists` |

- Several fields or operators must all match. `and` and `or` nest. Null and missing follow MongoDB's semantics.
- `contains` is a case-insensitive substring, never a regex.
- `has` matches an array with an element equal to its value. A missing or null array has none.
- `sort` is an array such as `['-createdAt', 'title']`. Only required, non-null string, number and enum fields sort. The default is `['-createdAt']`, and `id` is always the last tiebreak.
- `limit` is 1 to 100, default 20. `next` is an opaque cursor for `after`, or null on the last page.
- A field or operator the schema does not allow is a type error and `VALIDATION`.

`count` takes `{ where? }` and returns `{ count }`: how many documents `find` would return across every page. It runs `read` access and the tenant clause, as `find` does, validates `where` the same way, and writes one log line. A list that needs a total calls `find` and `count` side by side; `find` never counts.

### Errors

Every procedure declares `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404 with `{ collection, id }`), `CONFLICT` (409 with `{ collection, id }`) and `REFERENCED` (409 with `{ collection, id, by }`), plus the app's declared errors. `VALIDATION` is ts-pf's protocol code, with `{ path, message }[]` issues.

- `LatticeError` is the hexok `Errors` catalog behind those codes. Overrides and methods throw it, so they answer as the generated operations do: `LatticeError.NOT_FOUND({ collection: 'deals', id })`.
- The app's errors are a hexok `Errors` catalog, its client map and its mapper, as in hexok's app-template: `framework({ errors: { declared, map } })`. An app code that collides with Lattice's is a compile error.
- An error that is neither Lattice's nor mapped by the app reaches an HTTP client as `INTERNAL`. An in-process caller gets the original error.

### Events

`collection()` derives three hexok `Event` classes: `Contacts.events.created`, `.updated` and `.deleted`, with tokens `contacts.created` and so on. Payloads are `{ doc, actorId }`, and `{ doc, previous, actorId }` on update, typed from the schema. `doc` is the stored document. A tenanted collection's payloads also carry `tenantId`.

The app lists them in its own catalog, next to its hand-written events:

```ts
// examples/crm/src/domain/events/domain-events.ts
export class DomainEvents extends EventCatalog('domain-events', {
  companiesCreated: Companies.events.created,
  companiesUpdated: Companies.events.updated,
  companiesDeleted: Companies.events.deleted,
  contactsCreated: Contacts.events.created,
  contactsUpdated: Contacts.events.updated,
  contactsDeleted: Contacts.events.deleted,
  dealsCreated: Deals.events.created,
  dealsUpdated: Deals.events.updated,
  dealsDeleted: Deals.events.deleted,
  dealClosed: DealClosedEvent,
}) {}
```

Generated writes publish through `build({ events })` after the store write succeeds. A publish failure reaches the caller, and the write stays. Reads publish nothing. Overrides and methods publish their own events.

### `Repo` and `Doc`

`Repo<C>` is a typed view of the store for one collection: `get`, `getMany`, `find`, `count`, `insert`, `update` and `remove`. Use it in hand-written use cases and event handlers. It is trusted: it runs no hooks, no events and no access check.

- `insert` takes the schema's input type and parses it, as create does: defaults apply, unknown keys are dropped, and a failed check throws `LatticeError` `VALIDATION` with create's issues. Then it stamps `id`, `createdAt` and `updatedAt`.
- `update` takes a typed patch of the schema's output and writes it as given, with no parse. It bumps `updatedAt`.

Every call takes a scope as its last argument: the call's `Scope` from `ctx.access.scope()`, a tenant's from `tenancy.scope()`, or `unscoped`. A row outside the scope acts as missing. `unscoped` reads and writes every row; trusted code that acts for no caller passes it, such as a script. A `Scope` for another collection throws.

On a tenanted collection, `insert` stamps the scope's tenant and does not take `unscoped`. `update` never writes the tenant field. `scope.tenantId` is the tenant, for a method's own events.

`Doc<C>` is the collection's stored document type.

```ts
// examples/crm/src/app/use-cases/deals/archive-deal.ts
export class ArchiveDeal extends AppUseCase('deals.delete', {
  collection: Deals,
}) {
  constructor(private readonly deps: { deals: Repo<typeof Deals> }) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: { id: string },
  ): Promise<Doc<typeof Deals>> {
    const deal = await this.deps.deals.update(
      input.id,
      { archived: true },
      await ctx.access.scope(Deals, 'delete'),
    );
    // The same refusal the generated delete gives for a missing id.
    if (deal === null) {
      throw LatticeError.NOT_FOUND({ collection: Deals.slug, id: input.id });
    }
    return deal;
  }
}
```

### `CollectionStore` and `MemoryStore`

`CollectionStore` is the hexok port every collection uses: `ensure`, `find`, `count`, `get`, `getMany`, `insert`, `update`, `remove` and `transaction`. A `where` on a single-row call limits the rows it can touch; a row outside it acts as missing. `MemoryStore` is the in-memory adapter, for tests and examples. It stores copies and enforces unique indexes.

- `ensure(collection, indexes)` creates the indexes a collection lacks and never drops one. An `Index` is `{ fields: { status: 1, createdAt: -1 }, unique? }`. A unique index treats a missing field as null, as MongoDB does, and a write that breaks one is `CONFLICT`.
- `count(collection, where?)` counts the documents that match.
- `transaction(work)` runs `work` with a store whose calls join one unit: a commit, or on a throw, nothing. Each store makes it as atomic as it can, and a store without transactions runs `work` on itself, in order. A nested `transaction` joins the outer one. `MemoryStore` snapshots its collections and restores them on a throw; it does not isolate calls made outside `work` while it runs.

### Writing a store adapter

`@latticecms/core/store` has what an adapter needs: the `CollectionStore` port, its types (`StoredDoc`, `Patch`, `FindQuery`, `Page`, `Index`), the parsed filter (`AnyWhere`, with `FieldOps` for each field's operators), and the cursor helpers (`orderOf`, `Order`, `after`, `encodeCursor`). A store receives values Lattice has parsed. Filters follow MongoDB's null and missing rules, and the keyset of `after` is itself an `AnyWhere`, so a store applies it like any filter.

`@latticecms/core/store/conformance` has `storeCases`: the cases every store passes, asserted with `node:assert`, so any test runner runs them. Give each case a fresh store:

```ts
import { storeCases } from '@latticecms/core/store/conformance';

describe('MongoStore conformance', () => {
  let store: MongoStore;
  beforeEach(async () => {
    store = await freshStore();
  });
  afterEach(() => store.stop());

  it.each(storeCases)('$name', ({ run }) => run(store));
});
```

A case that needs a capability some stores lack says so in `needs`. A store without transactions runs the rest:

```ts
it.each(storeCases.filter((c) => !c.needs?.includes('transactions')))('$name', ({ run }) => run(store));
```

### Other types

- `Withheld` is `{ id: string }`: a populated document the caller may not read.
- `ReadUseCase<Proc, Ctx>` is the type of a populating read in `useCases`: its `execute` is generic in the `populate` list.
- `Ref<Slug, OnDelete>`, `Many<Target, Through, Fields, OnDelete>`, `RelationsOf` and `JoinShape` are the types of refs, relations and join collections. `OnDelete` and `ManyOnDelete` are their `onDelete` values. An app names them only when it exports its collections from a package with declarations.
- `CallAccess` is the type of `ctx.access`. `AccessRequest<Actor>` is what `Access.check` receives.
- `Scope` is what `ctx.access.scope()` and `tenancy.scope()` return.

## Guarantees

The tests prove each of these.

- A client of the contract needs no type annotations at the call site.
- An override keeps the contract's types, and a method adds a typed procedure.
- Each call writes one log line. Each refusal is logged once, whether the call came over RPC, in process, or through `useCases`.
- No use case runs when access says `false`, and no row outside an access `Where` is read, changed or returned.
- Each access function runs once per call.
- No call reaches another tenant's rows, and every bypassed call is logged.
- Events publish only after a successful write.
- A populated document passes its collection's `read` access and tenant, or comes back as `{ id }`.
- An update patch never resets a field to its default.
- On update, the merged document is validated with the whole schema.

## Not yet

These are not built. See the [phase table](../../docs/architecture.md#phased-build-plan).

- Auth. The app builds the actor at its edge; the CRM reads it from dev headers. An `@hexok/auth` recipe and an `@hexok/authz` adapter for `Access` come next.
- Field-level read masking.
- `entity`: a collection backed by a hexok `Entity` instead of a schema.
- A store per collection. One `build({ store })` serves every collection.
- Tracing spans.
- The admin UI, the CLI and file uploads.
