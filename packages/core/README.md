# @latticecms/core

Collections that compile into hexok use cases, hexok event classes and a ts-pf contract. A collection is a Zod schema with a slug. `framework()` turns a set of them into a typed RPC contract, and `build()` wires that contract to a store and an event publisher. Every generated piece is a real hexok `UseCase`, `Event`, `Errors` and `Port`, and a real ts-pf `router`, so a hand-written one can take its place with the same types.

Status: before 1.0, not yet published. Breaking changes are free until 1.0. The design and the reasons behind it are in [docs/architecture.md](../../docs/architecture.md).

## Install

```sh
npm install @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server @ts-pf/docs @ts-pf/mcp zod @hexok/logger @opentelemetry/api
```

Everything after `@latticecms/core` is a peer dependency: `hexok` 2, the `@ts-pf/*` packages 1, `zod` 4, `@hexok/logger` 0.2 and `@opentelemetry/api` 1. The app installs them, so it and Lattice share one copy of each:

- a `UseCase`, `Port` or `Errors` class the app imports is the same class Lattice built, so `instanceof` and hexok's checks hold;
- the contract's types are ts-pf's own, so every ts-pf client, `@ts-pf/openapi` and `@ts-pf/mcp` read them;
- a schema the app writes is the Zod Lattice parses with;
- the OpenTelemetry SDK the app registers is the one Lattice's spans reach.

`@ts-pf/docs` and `@ts-pf/mcp` carry the per-procedure descriptions; Lattice imports only `docs()` and the dependency-free `@ts-pf/mcp/meta`. Serve the result with `@ts-pf/server-http`, and call it with `@ts-pf/client`. A store adapter, such as [`@latticecms/store-mongo`](../store-mongo), is its own package.

## Quick start

One collection, one family, an in-memory store and an in-process client. It runs as is, with Node 24 (`node quickstart.ts`).

```ts
// examples/crm/src/quickstart/quickstart.ts
import { NoopLogger } from '@hexok/logger';
import { collection, family, framework, MemoryStore } from '@latticecms/core';
import { createLocalClient } from '@ts-pf/server';
import { z } from 'zod';

const Notes = collection('notes', {
  schema: z.object({
    title: z.string().min(1),
    done: z.boolean().default(false),
  }),
});

const AppUseCase = family({
  actor: z.object({ userId: z.string() }),
  actorId: (actor) => actor.userId,
});

const { app } = framework({ family: AppUseCase })
  .collection(Notes, {
    access: {
      read: () => true,
      create: () => true,
      update: () => true,
      delete: () => true,
    },
  })
  .build({
    store: new MemoryStore(),
    // Where collection events go: nowhere, here.
    events: { async publish(_event: { readonly payload: unknown }) {} },
  });

const client = createLocalClient(app, {
  context: { actor: { userId: 'ann' }, logger: new NoopLogger() },
});
const note = await client.notes.create({ title: 'Write the docs' });
await client.notes.update({ id: note.id, done: true });
const { docs } = await client.notes.find({ where: { done: { eq: true } } });
console.log(docs.map((doc) => doc.title));
```

It prints `[ 'Write the docs' ]`. The client is typed from the contract: `client.notes.find` takes a typed `where`, and returns typed documents with `id`, `createdAt` and `updatedAt`. Over HTTP, the same app is served by `@ts-pf/server-http`'s `FetchHandler`; see [The auth edge](#the-auth-edge).

## The agent skill

Core ships an agent skill in `skills/lattice`: a `SKILL.md` with the steps from a collection to an override, and one reference per concept (collections, access, tenancy, relations, masking, overrides, methods, event handlers, testing and the CLI), each quoting the crm. In an app that installs core, link it into the agents' skill directories with:

```bash
npx skills experimental_sync -y -r
```

It links `.agents/skills/lattice` to `node_modules/@latticecms/core/skills/lattice`, beside hexok's `hexok` skill and the `ts-pf-*` skills. `-r` also reads the dependencies of each workspace package, where a monorepo's app keeps them.

## Concepts

The examples come from [`examples/crm`](../../examples/crm): a CRM with tenanted companies, contacts and deals on MongoDB, served to signed-in members of an organization.

### Collections

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

Lattice adds `id`, `createdAt` and `updatedAt` to every document, and the tenant field to a tenanted one. `collection()`'s options are in the [reference](#collection-options).

#### Hooks

`.hooks({ beforeChange?, afterRead? })` returns the same collection with those hooks. A later call replaces a hook it names.

- `beforeChange({ data, operation, previous? })` runs after validation, before the write, on create and update. `data` is the whole document after the change, without system fields. It returns the data to store.
- `afterRead({ doc })` runs on every document a generated operation returns. It does not change what is stored or what events carry.

### The family

The app has one use case family. Generated and hand-written use cases extend it, and share its guards, logging and spans. `tenantOf` gives each call its organization, or a read-only bypass for support staff.

```ts
// examples/crm/src/app/use-cases/context.ts
import { family, tenancy } from '@latticecms/core';
import type { UseCase } from 'hexok';
import { z } from 'zod';
import { role } from '../../domain/collections/memberships.js';

/** A member acting in one organization, with its role there; the edge checked both. */
const memberSchema = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  role,
});

/**
 * Support staff: they read every organization's rows and change none. The
 * edge sets this from server config, never from the request, and a support
 * actor has no organization.
 */
const supportSchema = z.strictObject({
  userId: z.string().min(1),
  support: z.literal(true),
});

/**
 * Who is calling. The edge builds it from the session and the
 * organization header. Strict, so an actor with both an organization and
 * the support flag is invalid rather than read as either.
 */
export const actorSchema = z.union([memberSchema, supportSchema]);

export type Actor = z.output<typeof actorSchema>;

/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    'support' in actor ? tenancy.bypass : actor.organizationId,
});

export type AppCtx = UseCase.Ctx<typeof AppUseCase>;
```

`family({ actor, actorId, tenantOf? })` builds a hexok `UseCase.context` family.

A caller passes `{ actor, logger }` (`CallContext<Actor>`): the actor, and a `@hexok/logger` `Logger` for the call. Lattice adds `access`, the call's access, so a use case receives `{ actor, logger, access }` (`FamilyContext<Actor>`).

- Before `execute`, the actor must parse against `actor`, the input against the use case's `input` static, and access must allow the use case's action. A bad actor is `UNAUTHORIZED`, bad input is `VALIDATION`, and a refusal is `FORBIDDEN`.
- The actor is parsed once per call, and everything after sees the parsed value: access functions, `tenantOf`, `actorId`, log lines, `execute`'s `ctx.actor` and events. Keys the schema strips never reach them, and a transform's output does. Make an actor union of `z.strictObject`s when a key changes meaning, such as a `support` flag, so an actor that mixes the shapes is refused rather than read as one of them.
- `actorId` names the id that log lines and collection events carry. The family exposes `actor`, `actorId` and `tenantOf`, so hand-written code calls `AppUseCase.actorId(ctx.actor)`.
- `tenantOf` names the actor's tenant id, or `tenancy.bypass`. A framework with a tenanted collection requires it; see [Tenancy](#tenancy).
- Every call writes one line through a child of `ctx.logger` with `collection`, `action`, `actorId`, `tenantId` (or `tenancy: 'bypass'`), `outcome` and `durationMs`.
- A hand-written use case extends the family with a `collection` static, and `input` and `output` schemas for a method. Its token is `<slug>.<name>`.
- A method also says what it does, in `summary`, and how it affects data, in `effect`: `read`, `write` or `destructive`. They become its procedure's `docs` and `mcp` meta, so MCP tools, OpenAPI and the admin describe it from one place. An override declares neither: it keeps the meta of the operation it replaces.

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
export class CloseDeal extends AppUseCase('deals.close', {
  collection: Deals,
  input: z.object({ id: z.string(), outcome: z.enum(['won', 'lost']) }),
  // As a client receives a deal: the amount is withheld from a member.
  output: Deals.clientOutput,
  // What MCP tells a model, and the admin shows for the action.
  summary:
    'Close a deal as won or lost, by its id. A deal closes once; closing it again is AlreadyClosed.',
  effect: 'write',
}) {
```

`FamilyContext<Actor>` is the context type a use case receives, and `CallContext<Actor>` the one a caller passes. `Family<Actor, Tenanted>` is the family's type; `Tenanted` is true when it has `tenantOf`.

### The framework

`framework({ family, errors? })` starts a definition, and `.collection()` adds each collection with its access rules, and its methods and overrides. The definition holds no ports, so a client or a codegen script imports `contract` without the server.

```ts
// examples/crm/src/servers/rpc/contract.ts
import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { ArchiveDeal } from '../../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../../app/use-cases/deals/close-deal.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { Deals } from '../../domain/collections/deals.js';
import { Memberships } from '../../domain/collections/memberships.js';
import { Organizations } from '../../domain/collections/organizations.js';
import { clientErrors, toRpcError } from './errors.js';

/** Any signed-in caller may do this. The edge has already checked the actor. */
const anyone = () => true;

// An archived deal is hidden from every read and can no longer change.
const live = () => ({ archived: { eq: false } });

/** The CRM's API: five collections, one override and one method. No ports. */
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
    // A member sees every deal of the organization, without its amount.
    fields: {
      amount: {
        read: ({ actor }) => 'support' in actor || actor.role === 'manager',
      },
    },
    methods: { close: CloseDeal },
    overrides: { delete: ArchiveDeal },
  })
  .collection(Memberships, {
    // A caller lists its own memberships, in every organization. An
    // organization switcher uses /auth organizations instead, since /rpc
    // needs an organization first. No create, update or delete: only
    // trusted code writes them.
    access: { read: ({ actor }) => ({ userId: { eq: actor.userId } }) },
  })
  .collection(Organizations, {
    // A member reads the organization it acts in, and support every one.
    // No create, update or delete: only trusted code writes them.
    access: {
      read: ({ actor }) =>
        'support' in actor ? true : { id: { eq: actor.organizationId } },
    },
  });

/** What clients and codegen import. */
export const contract = crm.contract;

export { AppUseCase, Companies, Contacts, Deals, Memberships, Organizations };
```

`framework({ family, errors? })` starts a definition. `errors` is the app's `{ declared, map }`; an app with no domain errors leaves it out.

`.collection(C, { access, fields?, methods?, overrides? })` adds a collection. Its slug becomes a contract slice with `find`, `count`, `get`, `create`, `update` and `delete`. `access` is required; see [Access](#access).

- `fields: { amount: { read } }` gives each maskable field its read rule, and is required exactly when `C` has one; see [Field masking](#field-masking).
- `methods: { name: Class }` adds a procedure. `overrides: { action: Class }` replaces a generated one.
- Each class must name `C` and its token, and its `execute` must take and return the procedure's types. A mismatch, a reserved name, or a slug added twice is a compile error and a runtime throw.
- A slug, relation or method may not be one of `reservedNames`: `$context`, `use`, `useAfter`, `middleware` and `router`, the ts-pf implementer's own keys.
- A method without `summary` and `effect`, and an override with either, is a compile error and a runtime throw. The error names the method or override. A blank `summary` throws.

`.contract` is the ts-pf contract, built once on first read. `Contract<E, D>` is its type.

### `build()`

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
- Await `ensure()` after the store has started and before serving, as the CRM's [`server.ts`](#build) does.
- `Framework<Actor, D, E, Tenanted>` is the definition's type.

The server starts the store, runs the migrations, creates the indexes, then serves:

```ts
// examples/crm/src/servers/http/server.ts
const crm = createApp({ store, events: deps.events });
await store.start();
await migrate(store, migrations, { logger });
await crm.ensure();
```

A client needs no annotations. Input, output and declared errors come from the contract, so the client narrows on the app's `AlreadyClosed` and its `data`:

```ts
// examples/crm/src/servers/app.test.ts
const deal = await local.deals.create({
  title: 'Big one',
  companyId: 'c1',
  amount: 1000,
});

const won = await local.deals.close({ id: deal.id, outcome: 'won' });
expect(won).toMatchObject({ stage: 'won', closedAt: expect.any(String) });
```

```ts
// examples/crm/src/servers/app.test.ts
const again = await asResult(
  local.deals.close({ id: deal.id, outcome: 'lost' }),
);
if (again.ok) throw new Error('expected AlreadyClosed');
if (again.error.code !== 'AlreadyClosed')
  throw new Error(again.error.code);
expectTypeOf(again.error.data).toEqualTypeOf<{ id: string }>();
expect(again.error.data).toEqual({ id: deal.id });
expect(again.error.status).toBe(409);
```

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

`Access` is the hexok port behind this. `build({ access })` takes another adapter of it. Its `check({ actor, collection, action, data? })` returns `boolean` or a `Where`; `action` is `find`, `count`, `get`, `create`, `update`, `delete` or a method's name, and `data` is passed for `create` only. Its `readable({ actor, collection, fields })` returns which of a collection's maskable fields the actor may read; a field it leaves out is withheld, so an adapter that forgets one withholds it.

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
- In the output's JSON Schema, and so in OpenAPI and MCP, the tenant field carries `x-lattice-tenant: true`, so a client such as the admin shows it read-only.
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

### Relations and population

#### Refs and `onDelete`

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
- A ref's JSON Schema says where it points, as `x-lattice-ref: 'companies'`: in inputs, outputs, the id branch of a populated field, each item of a list of ids, and a join collection's ids. OpenAPI and MCP carry it, and the admin links and picks documents by it.

`onDelete` says what the generated delete of the referenced document does to the documents that refer to it:

| `onDelete` | When a referenced document is deleted |
| --- | --- |
| `restrict` (default) | The delete is refused with `REFERENCED` (409), `{ collection, id, by: { collection, field, relation? } }`, while any document refers to it |
| `cascade` | The referring documents are deleted too, and their own refs are followed in turn. A cycle stops at a document already deleted. A list of ids cannot cascade |
| `nullify` | The ref is cleared: an optional field is removed, a nullable one set to null, and the id pulled from a list. A required ref cannot nullify |

- These are system steps: they skip access functions, because the caller was allowed to delete the parent. They stay inside the parent's tenant, so another tenant's row that stores this id is neither counted nor touched. A global parent's children are found across tenants.
- Everything runs in one `store.transaction()`, with the parent deleted last. Restrict is checked before anything is written. Each cascaded document emits its `deleted` event and each nullified one its `updated` event, after the commit, never inside it. A failure rolls the whole delete back, and nothing is published.
- A collection that overrides `delete` cannot have a cascading ref: the cascade would hard-delete rows its override keeps, such as soft-deleted deals. It is a compile error and a throw at `.collection()`; use `restrict` or `nullify`.
- `onDelete` runs in the generated delete only. An override of `delete`, such as a soft delete, keeps the row, so its children stay valid; an override that removes rows handles their refs itself. `Repo.remove` is trusted and does not run it.

#### `many()` relations

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

- The join collection is `Posts.relations.categories.through`, with slug `through`. Its documents are `{ postsId, categoriesId, ...fields }` plus the system fields and the parent's tenant field. `postsId` cascades from the post; `categoriesId` takes `onDelete` (`restrict` by default, or `cascade`). A category the join restricts is `REFERENCED` with `by: { collection: 'post_categories', field: 'categoriesId', relation: { collection: 'posts', name: 'categories' } }`: the join collection is not in the catalog, so `relation` names the relation a client can show. It has its own events, which the app lists in its catalog like any collection's, and it is in `repos` (`repos.post_categories`), but it has no slice: links change only through `set`.
- It gets a unique index on the pair, and one on `categoriesId`, both led by the tenant field.
- `posts.categories.list({ id, where?, sort?, limit?, after? })` pages the post's links, with find's `where`, `sort` and cursor over the link documents. It runs the post's `read` access: a post outside it is `NOT_FOUND`.
- `posts.categories.set({ id, links })` replaces the post's links: each link is `{ categoriesId, ...fields }`, at most 1000, and a target repeated is `VALIDATION`. It runs the post's `update` access. It diffs, in one `store.transaction()`: links no longer listed are deleted, new ones inserted, and changed fields updated; an unchanged link keeps its id and `createdAt`. Each change emits its own join event, after the commit. It returns the links in the order given. A tenant bypass cannot set.
- Both are use cases in the family (`useCases.posts.categories.set`), and can be overridden: `overrides: { categories: { set: ReorderCategories } }`.
- A relation name may not be a schema field, an operation, `read`, a method or a ts-pf implementer key, and `through` may not be another collection's slug. A collection cannot relate to itself with `many()`. A link field may not be named like the two ref fields, a reserved name or the tenant field. Method names may not contain a dot. Each is a compile error and a throw.

#### Population

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

### Field masking

A collection names the fields a caller's rules may withhold, with `maskable`. Composition gives each a read rule, in `.collection(C, { fields })`; see [Masking by role](#masking-by-role). The rule receives `{ actor }` and is asked once per call per collection.

```ts
// examples/crm/src/domain/collections/deals.ts
export const Deals = collection('deals', {
  schema: z.object({
    title: z.string().min(1),
    // An archived deal still refers to its company, so it restricts too.
    companyId: ref('companies'),
    amount: z.number().nonnegative(),
    stage: z.enum(dealStages).default('lead'),
    // deals.delete archives: the row stays, with archived set.
    archived: z.boolean().default(false),
    closedAt: z.iso.datetime().optional(),
  }),
  tenant: 'organizationId',
  // The people on a deal, and what each is to it. A contact on a deal
  // cannot be deleted: restrict, the default.
  relations: {
    contacts: many('contacts', {
      through: 'deal_contacts',
      fields: z.object({ role: contactRole }),
    }),
  },
  // Only managers and support see amounts: the contract's fields rule.
  maskable: ['amount'],
  // The pipeline view: one organization's deals in a stage, newest first.
  indexes: [{ fields: { organizationId: 1, stage: 1, createdAt: -1 } }],
});
```

- A withheld field is left out of what a client receives: `get`, `find`, `create`, `update` and `delete`, a relation's `list`, and documents populated into another collection's read, under the caller's rule for that collection. It is masked where every procedure returns to a client (HTTP, `createLocalClient`, MCP), so overrides and methods are masked too.
- A client's type has the field optional: `deal.amount` is `number | undefined`, for every caller, since types cannot follow the actor. `ClientDoc<C>` names that document; `Doc<C>` stays the stored one.
- A `where` or a `sort` on a field the caller may not read, at any depth, on `find` or `count`, is `VALIDATION` naming its path. So no filter, count, order or cursor reveals it. A caller who may read it filters and sorts as usual.
- An `update` whose patch names a field the caller may not read, with a value or `null`, is `VALIDATION` at its path: `"amount" is not readable, so it cannot be changed`. A caller cannot see what the write would destroy. The family's guard checks it, so an override of `update` is refused too. `create` still takes the field, so a caller who may not read a required maskable field can create the document.
- A method that returns a collection's documents declares `output: Deals.clientOutput`, or a schema built from it (`.extend()`, `.pick()`, `shape.amount`). An output that holds a maskable field where it is required, such as `Deals.output`, throws at `build()`, and so does an output Lattice cannot see through (`z.lazy()`, a transform, `z.custom()`, `z.unknown()`, `z.any()`) in an app with a maskable field.
- Server code sees whole documents: repos, direct `useCases.*.execute` calls and events' `doc`. A page rendered for a user calls through `createLocalClient`. Masking for a webhook happens where the webhook maps the event.
- In JSON Schema, and so in OpenAPI and MCP, the field is optional, with `x-lattice-maskable: true` and the description "Withheld when the caller may not read it." Its `where` entry says "Refused (VALIDATION) when the caller may not read amount.", and a `sort` that could name it says the same. Meta the app gave the field, such as a `title`, stays.

Masking covers the named field only. These can still reveal it:

- An object-level `.refine()` that reads a maskable field can fail a non-reader's update depending on the hidden value. Don't refine across a maskable field.
- An access `Where` that filters rows by a maskable field, such as `read: () => ({ amount: { lt: 1000 } })`, reveals a bound through which rows exist.
- An `afterRead` hook that derives another field from a masked one, or a method that computes a field of its own from it, is not masked.

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
  membershipsCreated: Memberships.events.created,
  membershipsUpdated: Memberships.events.updated,
  membershipsDeleted: Memberships.events.deleted,
  organizationsCreated: Organizations.events.created,
  organizationsUpdated: Organizations.events.updated,
  organizationsDeleted: Organizations.events.deleted,
  dealContactsCreated: Deals.relations.contacts.through.events.created,
  dealContactsUpdated: Deals.relations.contacts.through.events.updated,
  dealContactsDeleted: Deals.relations.contacts.through.events.deleted,
  dealClosed: DealClosedEvent,
}) {}
```

- Generated writes publish through `build({ events })` after the store write succeeds. A publish failure reaches the caller, and the write stays. Reads publish nothing. Overrides and methods publish their own events.
- Collection events stay inside the product. Another product or a customer gets a mapping of its own: an integration event or a webhook. See [A worker](#a-worker-webhooks-and-integration-events).

### Tracing

Lattice traces through `@opentelemetry/api`. With no OpenTelemetry SDK registered, the API is a no-op, and that is the switch: there is no option. An app that registers an SDK, with a context manager such as `@opentelemetry/context-async-hooks`, gets these spans. Their tracer is `@latticecms/core`, at the package's version.

| Span | Kind | Where | Attributes |
| --- | --- | --- | --- |
| `deals/find`, one per procedure | server | Lattice's router middleware, on every caller: HTTP, `createLocalClient`, MCP | `rpc.system` (`ts-pf`), `rpc.service` (`deals`), `rpc.method` (`find`; a relation's is `categories/list`), `lattice.outcome`, `lattice.code` |
| `deals.find`, one per use case | internal | the family's hooks, on every path, `useCases` too | `lattice.use_case`, `lattice.collection`, `lattice.action`, `lattice.actor_id`, `lattice.tenant_id` or `lattice.tenancy: 'bypass'`, `lattice.outcome`, `lattice.code` |

- The procedure span is active while the procedure runs. The use case span is its child, or the caller's span's on a direct `useCases.*.execute`.
- A store's spans, such as MongoStore's, are children of the active span: the procedure's, or the caller's. hexok has no hook around `execute`, so the use case span cannot be made active: a store call is its sibling, not its child.
- `lattice.outcome` is `ok`, `refused` or `failed`. A refusal (`FORBIDDEN`, `NOT_FOUND`, `VALIDATION`, any declared code) sets `lattice.code` and leaves the status unset: it is the caller's, not a failure. An unexpected throw sets status ERROR, `error.type`, and an exception event.
- A guard's refusal, and ts-pf's own input check, happen before the use case's hooks: they show on the procedure span only.
- A span carries no input, no document and no masked value: only names, ids, codes and outcomes.

To export these spans, register an SDK at startup; see [Tracing with an SDK](#tracing-with-an-sdk).

### MCP and OpenAPI

Each generated procedure carries `docs({ summary })` and `mcp({ effect })` in its `.meta()`, so `@ts-pf/openapi`, `@ts-pf/codegen` and `@ts-pf/mcp` describe it with no code in the app. The summary names the collection by its label; see the [reference](#collection-options).

| Procedure | `effect` | Summary, for `deals` |
| --- | --- | --- |
| `find` | `read` | Find deals. Filter with where, order with sort, and page with limit and after (the previous page’s next). populate expands companyId into documents. |
| `count` | `read` | Count deals. Filter with where. |
| `get` | `read` | Get one deal by id. populate expands companyId into documents. |
| `create` | `write` | Create one deal. |
| `update` | `write` | Update one deal by id. Send only the fields to change, and null to clear an optional one. |
| `delete` | `destructive` | Delete one deal by id. |
| a relation's `list` | `read` | List the categories of one post, by its id. … |
| a relation's `set` | `destructive` | Replace the categories of one post, by its id. Links not given are removed. |

- The `populate` sentence appears only when the read can populate.
- `@ts-pf/mcp` turns `read` into `readOnlyHint: true`, and `destructive` into `destructiveHint: true`. The effect is a literal in the contract's type too, so `all(tk.deals, { effect: 'read' })` selects in types what it selects at runtime.
- A method's meta comes from its `summary` and `effect` statics; see [The family](#the-family). An override keeps its procedure's meta.
- Every procedure also carries a `lattice` key: its collection, the collection's label, and its operation. A relation's `list` and `set` name the relation and its `target` collection, and a method names itself: `{ collection: 'deals', label: { singular: 'deal', plural: 'deals' }, operation: 'method', method: 'close' }`. `LatticeMeta` is its type. A client such as the admin reads it from `catalog()`, instead of guessing from a procedure's path.

A maskable field says in its JSON Schema that it may be withheld, and that a query on it may be refused; see [Field masking](#field-masking). A populated read has ts-pf's `x-ts-pf-expand` in OpenAPI. The crm serves both; see [Serving MCP and OpenAPI](#serving-mcp-and-openapi).

## Recipes

Each recipe quotes [`examples/crm`](../../examples/crm), and names the file, or links to the root README's Getting started. A test in the crm checks that every quote here matches its file, and the walkthrough runs Getting started as written.

### The smallest edge

The root README's [Getting started](../../README.md#4-the-server) has the smallest edge that keeps these rules: a fixed token from `@hexok/auth`'s `StaticTokenAuthenticator`, a membership check on every call, and the actor built only after both. A test runs it as written. The crm's edge below is the same shape with sessions, support actors and MCP.

### The auth edge

Lattice never imports auth. The edge decides who the actor is, and passes it in the call context. In the crm, a `@hexok/auth` session proves the user, and a membership lookup checks the organization the request names, on every request:

```ts
// examples/crm/src/servers/http/handler.ts
async function signedIn(
  deps: HttpDeps,
  request: Request,
  logger: Logger,
  edge: Edge,
): Promise<{ readonly userId: string; readonly token: string } | undefined> {
  const refused = (reason: string) => {
    logger.info(edge, { outcome: 'refused', code: 'UNAUTHORIZED', reason });
    return undefined;
  };
  const token = bearerToken(request.headers.get('authorization'));
  // The reason hexok's sessions give for no token.
  if (token === undefined) return refused('missing');
  const found = await deps.sessions.authenticate(token);
  if (!found.ok) return refused(found.code);
  return { userId: found.value.userId, token };
}
```

```ts
// examples/crm/src/servers/http/handler.ts
function actorContext(deps: HttpDeps) {
  const memberships = deps.crm.repos.memberships;
  return async (
    userId: string,
    request: Request,
    logger: Logger,
    edge: Edge,
  ): Promise<CallContext<Actor>> => {
    if (deps.support.has(userId)) {
      return { actor: { userId, support: true }, logger };
    }
    const organizationId = request.headers.get(organizationHeader);
    // Trusted edge code: it decides who the actor is, so no actor's access
    // applies yet. A missing organization and one that does not exist look
    // the same as one the user is not a member of.
    const [member] =
      organizationId === null
        ? []
        : (
            await memberships.find(
              {
                where: {
                  userId: { eq: userId },
                  organizationId: { eq: organizationId },
                },
                limit: 1,
              },
              unscoped,
            )
          ).docs;
    if (organizationId === null || member === undefined) {
      logger.info(edge, {
        outcome: 'refused',
        code: 'FORBIDDEN',
        reason: organizationId === null ? 'no-organization' : 'not-a-member',
      });
      throw refusal('FORBIDDEN');
    }
    return { actor: { userId, organizationId, role: member.role }, logger };
  };
}
```

`FetchHandler` serves the app at `/rpc` with that context, and `onError` from `build()` logs what the family did not:

```ts
// examples/crm/src/servers/http/handler.ts
  const onError = deps.crm.onError(deps.logger);
  const api = new FetchHandler(deps.crm.app, { onError });
  const auth = new FetchHandler(createAuthRouter(deps), { onError });
  const contextOf = actorContext(deps);
  const apiContext = async (request: Request) => {
    const logger = deps.logger.child({ requestId: requestIdOf(request) });
    const user = await signedIn(deps, request, logger, 'rpc');
    if (user === undefined) throw refusal('UNAUTHORIZED');
    return contextOf(user.userId, request, logger, 'rpc');
  };
```

| Case | Answer |
| --- | --- |
| No token, a bad or expired one, or an ended session | `401 UNAUTHORIZED`, one body for all |
| No organization header, not a member, or no such organization | `403 FORBIDDEN`, one body for all |
| A support user | Reads every organization, changes nothing |

The reason is logged, never sent. A switched or revoked membership takes effect on the next request, because the check runs on each one.

### Login on its own router

Sign-in is not a Lattice procedure: every Lattice procedure has an actor, and a caller signing in has none yet. The crm serves it at `/auth`, beside `/rpc`, as a plain ts-pf router, with sign-out and the caller's organizations:

```ts
// examples/crm/src/servers/auth/contract.ts
export const authContract = router({
  login: procedure
    .input(loginInput)
    .output(z.object({ token: z.string().min(1) }))
    .errors({
      UNAUTHORIZED: { status: 401, message: 'The credentials are not valid' },
    }),
  logout: procedure.input(z.object({})).output(z.null()),
  /**
   * The organizations the signed-in user is a member of, by name, for an
   * organization switcher. It needs a session and no organization header:
   * the caller has not picked one yet. Support acts in none, so it gets none.
   */
  organizations: procedure
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .errors({
      UNAUTHORIZED: { status: 401, message: 'The actor is missing or invalid' },
    }),
});
```

```ts
// examples/crm/src/servers/auth/router.ts
    login: impl.login.handler(async ({ context, input }) => {
      try {
        const { userId } = await deps.login.execute(
          { logger: context.logger },
          input,
        );
        return { token: await deps.sessions.open({ userId }) };
      } catch (error) {
        if (!LoginError.is(error)) throw error;
        throw new PFError({
          code: 'UNAUTHORIZED',
          status: 401,
          message: error.message,
          cause: error,
        });
      }
    }),
```

- The `Login` use case checks the password and the lockout; the router opens the session. The use case never sees a token.
- `organizations` lists the signed-in user's organizations, `{ id, name }`, sorted by name, for an organization switcher. It needs a session and no organization header, since the caller has not picked one yet. It runs the edge's own session check, and reads memberships and organizations through their repos as trusted edge code, as the membership check does. Support gets none.
- Password hashes and failed attempts live in store collections Lattice never registers, `credentials` and `login_attempts`, so no procedure, MCP tool or OpenAPI document can reach them.
- The crm's [README](../../examples/crm/README.md#passwords-and-their-limits) gives the hashing and lockout rules.

### Masking by role

The edge puts the member's role on the actor ([The auth edge](#the-auth-edge)), and the collection's `fields` rule reads it:

```ts
// examples/crm/src/servers/rpc/contract.ts
    // A member sees every deal of the organization, without its amount.
    fields: {
      amount: {
        read: ({ actor }) => 'support' in actor || actor.role === 'manager',
      },
    },
```

A member's `deals.find` has no `amount`, and a `where` or `sort` on it is `VALIDATION`. A manager and support read it, and a manager filters by it. A member may still set it on create or update; the response leaves it out. The crm tests this over HTTP in [`masking.test.ts`](../../examples/crm/src/servers/http/masking.test.ts).

### A worker: webhooks and integration events

Collection events stay inside the product. In the crm, the HTTP process publishes each domain event to a `@hexok/queue` queue, and a worker process maps the ones that leave: a customer webhook through `@hexok/webhooks`, and an integration event for the company's other products through `@hexok/integration-events`.

```ts
// examples/crm/src/servers/worker/worker.ts
  const integration = new IntegrationPublisher(CrmDeals, {
    queue: deps.integrationQueue,
  });

  const handlers = [
    new SendDealClosedWebhook({ deals: repos.deals, webhooks, logger }),
    new PublishDealClosed({ deals: repos.deals, integration, logger }),
  ];
```

A handler is system code. It reads inside the event's own tenant, with `tenancy.scope`, never with an actor's access, and maps the document field by field, so a new field on the collection reaches no one outside until it is added to the mapping:

```ts
// examples/crm/src/app/event-handlers/deal-closed-integration.ts
  async handle(event: DealClosedEvent): Promise<void> {
    const { dealId, outcome, tenantId } = event.payload;
    const deal = await this.deps.deals.get(
      dealId,
      tenancy.scope(Deals, tenantId),
    );
    if (deal === null || deal.closedAt === undefined) {
      this.deps.logger.warn('deal.closed integration skipped', {
        dealId,
        tenantId,
        reason: deal === null ? 'not-found' : 'not-closed',
      });
      return;
    }
    await this.deps.integration.publish(
      new DealClosedV1(dealClosedV1(deal, tenantId, outcome, deal.closedAt)),
      // A deal closes once: a redelivery publishes the same id, and a
      // consumer dedupes on it.
      { id: `deal.closed:${deal.id}`, subject: deal.id },
    );
  }
```

- Each handler subscribes in its own consumer group, inside a consumer span, through [`subscribe.ts`](../../examples/crm/src/servers/worker/subscribe.ts).
- The webhook leaves out `amount`, a field only managers read. The integration contract, [`src/integration/deals.ts`](../../examples/crm/src/integration/deals.ts), carries it: it is internal to the company.
- Masking applies where a document leaves for a client. Events and repos carry whole documents, so each mapping decides what leaves.

### Tracing with an SDK

Lattice's spans and the store's need an SDK and a context manager registered once, before the app serves. The crm's tests register one with an in-memory exporter; an app does the same at startup with its exporter, such as `@opentelemetry/sdk-node` and OTLP:

```ts
// examples/crm/src/servers/http/tracing.test.ts
const exporter = new InMemorySpanExporter();
beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }),
  );
});
```

A `deals/find` over HTTP is then a procedure span with the use case span and the store call under it. The crm's production processes register no SDK, so they record nothing.

### Serving MCP and OpenAPI

The crm turns the contract into MCP tools with `@ts-pf/mcp`. Every tool describes itself, generated or a method. The procedures no caller may use are the app's to leave out:

```ts
// examples/crm/src/servers/mcp/toolset.ts
const tk = createToolkit(contract).$context<CallContext<Actor>>();

// No access rule allows these, so every call is FORBIDDEN: as tools they
// would only cost a model context and wrong turns. They stay on /rpc.
const alwaysDenied = [
  tk.memberships.create,
  tk.memberships.update,
  tk.memberships.delete,
  tk.organizations.create,
  tk.organizations.update,
  tk.organizations.delete,
];

/**
 * The API's procedures as MCP tools, each named by its path. Every one
 * carries its summary and effect from the contract: Lattice writes them for
 * generated operations, and a method declares them on its use case.
 */
export const crmTools = tk.$toolset({
  tools: [all(tk, { exclude: alwaysDenied })],
});

// A new procedure fails this line until the toolset exposes it or this
// line excludes it.
tk.$coverage({ toolsets: [crmTools], exclude: alwaysDenied });
```

The tools run in process through the implemented router, so access, tenancy, masking, errors and spans are the same as on `/rpc`. The edge checks the session before the MCP SDK reads the request, and the tool context reuses the auth edge's `actorContext`:

```ts
// examples/crm/src/servers/http/handler.ts
  const tools = bindTools(crmTools, {
    app: deps.crm.app,
    onError,
    async context(info) {
      const userId = info.authInfo?.extra?.userId;
      const requestId = info.authInfo?.extra?.requestId;
      const request = info.requestInfo;
      // The edge sets all three before the SDK runs: this is a bug guard.
      if (
        typeof userId !== 'string' ||
        typeof requestId !== 'string' ||
        request === undefined
      ) {
        throw refusal('UNAUTHORIZED');
      }
      return contextOf(
        userId,
        request,
        deps.logger.child({ requestId }),
        'mcp',
      );
    },
  });
```

The OpenAPI document is a projection of the contract's catalog, with ts-pf's `codegen` profile for generators in other languages:

```ts
// examples/crm/src/servers/rpc/openapi.ts
export function openapiDocument() {
  return openapi(catalogDocument(), {
    info: { title: 'Lattice CRM', version: '0.0.0' },
    profile: 'codegen',
  });
}
```

The crm serves it at `GET /openapi.json`, and the catalog itself at `GET /catalog.json`, to signed-in users only, since both say which fields are masked. The catalog carries each procedure's `lattice` meta and the `x-lattice-*` keys; the admin builds its views from it. A TypeScript client in another repo uses `@ts-pf/codegen` on the same catalog instead; the crm's [`codegen.test.ts`](../../examples/crm/src/servers/rpc/codegen.test.ts) is that client, with no casts.

### Mounting the admin

[`@latticecms/admin`](../admin) renders the app from the catalog it serves. The crm's page signs in through `/auth`, lists the user's organizations for a switcher from `/auth organizations`, which needs no organization header, and calls the API with the picked one:

```tsx
// examples/crm/src/web/app.tsx
  const auth = useMemo(
    () => authClient(sessionFetch(token, undefined, onSignedOut)),
    [token, onSignedOut],
  );
  // A 401 signs out through the session's fetch. Anything else, such as a
  // dropped connection, can be tried again.
  const load = useCallback(() => {
    setFailed(false);
    auth.organizations({}).then(setOrganizations, () => setFailed(true));
  }, [auth]);
  useEffect(load, [load]);
  const current =
    organizations?.find(({ id }) => id === picked) ?? organizations?.[0];
  const fetch = useMemo(
    () => sessionFetch(token, current?.id, onSignedOut),
    [token, current, onSignedOut],
  );
```

`<Admin>` is keyed by the organization, so a switch starts with an empty cache and never shows another organization's rows:

```tsx
// examples/crm/src/web/app.tsx
    <Admin
      // A new organization is a new admin, with an empty cache.
      key={current?.id ?? 'support'}
      fetch={fetch}
      catalogUrl="/catalog.json"
      basePath="/admin"
```

The edge checks the organization header on every call, as in [The auth edge](#the-auth-edge). The admin's README has its props, the catalog route and what it renders. The smallest page, a token form, is in the root README's [Getting started](../../README.md#5-the-admin-page).

## Reference

### `collection()` options

`collection(slug, { schema, tenant?, indexes?, relations?, maskable?, label? })`

Returns a `Collection` with `slug`, `label`, `schema`, `tenant`, `indexes`, `output`, `clientOutput`, `maskable`, `events` and `hooks()`. `output` is the stored document's schema: the collection's schema plus `id`, `createdAt`, `updatedAt` and the tenant field. `clientOutput` is the document a client receives: `output`, with each maskable field optional.

- `schema` is a `z.object()`. Unknown keys are stripped.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names, listed in `reservedFields`. The tenant field may not be one either.
- No `z.date()` and no transforms, anywhere in the schema. Store ISO strings (`z.iso.datetime()`). Normalize in a `beforeChange` hook. `collection()` throws at definition time, and a top-level Date or reserved name fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings.
- `tenant: 'organizationId'` makes the collection tenanted; see [Tenancy](#tenancy). Without it, the collection is global.
- A field name may not contain `.`, start with `$`, or be `_id`: MongoDB would read it as a path, an operator or the id.
- `maskable: ['amount']` names schema fields a caller's rules may withhold; see [Field masking](#field-masking). A maskable field may not be a ref or in a unique index.
- `label: { singular: 'person', plural: 'people' }` says how the collection reads mid-sentence, in generated summaries and the admin. Without it, the label comes from the slug: `deal_stages` reads "deal stage" and "deal stages". Declare it when the slug's singular would be wrong, as for `people` or `news`. `labelOf(slug)` returns the label a slug gets.
- A field's label in a client such as the admin is its name in words, or its JSON Schema `title`: `amount: z.number().meta({ title: 'Deal value' })`. Zod's `.meta()` reaches the catalog, OpenAPI and MCP.
- `indexes` lists the indexes the store creates at startup, through `build().ensure()`: `[{ fields: { stage: 1, createdAt: -1 } }, { fields: { email: 1 }, unique: true }]`. Fields are named from the stored document, so the system fields and the tenant field count; any other name is a compile error and a throw. Key order is the index's order. `id` needs no index. A tenanted collection's indexes usually lead with the tenant field, because every call filters by it; Lattice does not add it for you.

### Catalog facts

`catalog(contract)` from `@ts-pf/docs` carries what a client such as the admin needs, so it reads them instead of guessing from paths and names:

| Fact | Where | What it says |
| --- | --- | --- |
| `lattice` meta | Each procedure's meta | Its collection, the collection's label, and its operation; a relation's name and `target`; a method's name. `LatticeMeta` is its type |
| `docs` and `mcp` meta | Each procedure's meta | Its summary and its effect: `read`, `write` or `destructive`. A method's come from its `summary` and `effect` statics |
| `x-lattice-ref` | A ref's JSON Schema | The slug of the collection it points to |
| `x-lattice-maskable` | A maskable field's JSON Schema | That a caller's rule may withhold it |
| `x-lattice-tenant` | The tenant field's JSON Schema | That Lattice stamps it, so a client shows it read-only |
| `title` | A field's JSON Schema, from `.meta({ title })` | Its label; without one, a client uses its name in words |

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
- `sort` is an array such as `['-createdAt', 'title']`. Only required, non-null string, number and enum fields sort. The default is `['-createdAt']`, and `id` is always the last tiebreak. Its JSON Schema lists every key it accepts, so a client sees the valid keys.
- `limit` is 1 to 100, default 20. `next` is an opaque cursor for `after`, or null on the last page.
- A field or operator the schema does not allow is a type error and `VALIDATION`.

`count` takes `{ where? }` and returns `{ count }`: how many documents `find` would return across every page. It runs `read` access and the tenant clause, as `find` does, validates `where` the same way, and writes one log line. A list that needs a total calls `find` and `count` side by side; `find` never counts.

`update` takes `{ id }` and the fields to change. A field left out keeps its value, and a patch never applies a default.

- `null` clears an optional field with no default: the key is removed, and the `updated` event's `doc` lacks it. Its JSON Schema, and so its client type, takes `null`: `closedAt?: string | null`.
- A nullable field stores `null`. A required or defaulted field refuses `null` with `VALIDATION` at its path.
- The document after the change is validated with the whole schema, so an object-level `.refine()` holds on update too.

### Errors

Every procedure declares `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404 with `{ collection, id }`), `CONFLICT` (409 with `{ collection, id }`) and `REFERENCED` (409 with `{ collection, id, by }`), plus the app's declared errors. `VALIDATION` is ts-pf's protocol code, with `{ path, message }[]` issues.

- `LatticeError` is the hexok `Errors` catalog behind those codes. Overrides and methods throw it, so they answer as the generated operations do: `LatticeError.NOT_FOUND({ collection: 'deals', id })`.
- The app's errors are a hexok `Errors` catalog, its client map and its mapper, as in hexok's app-template: `framework({ errors: { declared, map } })`. An app code that collides with Lattice's is a compile error.
- An error that is neither Lattice's nor mapped by the app reaches an HTTP client as `INTERNAL`. An in-process caller gets the original error.

### `Repo` and `Doc`

`Repo<C>` is a typed view of the store for one collection: `get`, `getMany`, `find`, `count`, `insert`, `update` and `remove`. Use it in hand-written use cases and event handlers. It is trusted: it runs no hooks, no events and no access check.

- `insert` takes the schema's input type and parses it, as create does: defaults apply, unknown keys are dropped, and a failed check throws `LatticeError` `VALIDATION` with create's issues. Then it stamps `id`, `createdAt` and `updatedAt`.
- `update` takes a typed patch of the schema's output and writes it as given, with no parse. It bumps `updatedAt`. A key set to `undefined` removes the field.

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
- `LatticeMeta` is the `lattice` key of each procedure's meta; see [MCP and OpenAPI](#mcp-and-openapi).
- `ClientDoc<C>` is a collection's document as a client receives it, each maskable field optional.
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
- A field a caller may not read never reaches it through a procedure's output, a filter, a count, a sort or a cursor, and the caller's update cannot change or clear it.
- An update patch never resets a field to its default.
- On update, the merged document is validated with the whole schema.

## Not yet

These are not built. [docs/architecture.md](../../docs/architecture.md#known-limits) lists the known limits of what is.

- An `@hexok/authz` adapter for `Access`. It waits for hexok to release `@hexok/authz`.
- `entity`: a collection backed by a hexok `Entity` instead of a schema.
- A store per collection. One `build({ store })` serves every collection.
- File uploads: a file field, its blob storage and downloads.
