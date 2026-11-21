# @latticecms/core

Collections that compile into hexok use cases, hexok event classes and a ts-pf contract. A collection is a Zod schema with a slug. `framework()` turns a set of them into a typed RPC contract, and `build()` wires that contract to a store and an event publisher. Lattice builds on [hexok](https://www.npmjs.com/package/hexok) and [ts-pf](https://www.npmjs.com/package/@ts-pf/server) rather than replacing them: every generated piece is a real hexok `UseCase`, `Event`, `Errors`, `Port` and ts-pf `router`, so a hand-written one can take its place with the same types.

Status: Phase 0, not published. The design and the reasons behind it are in [docs/architecture.md](../../docs/architecture.md).

## Install

```sh
npm i @latticecms/core zod @hexok/logger
```

`zod` 4 and `@hexok/logger` are peer dependencies. `hexok`, `@ts-pf/contract`, `@ts-pf/server` and `@ts-pf/protocol` are dependencies. Serve the result with `@ts-pf/server-http`, and call it with `@ts-pf/client`.

## Example

From [`examples/crm`](../../examples/crm): three collections, one override, one custom method and one app error, served at `/rpc`.

A collection is a slug and a `z.object()` schema. Hooks transform data and nothing else.

```ts
// examples/crm/src/domain/collections/contacts.ts
import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.email(),
    // A plain id until ref() arrives in Phase 1.
    companyId: z.string(),
  }),
}).hooks({
  // One spelling per address, so a where on email finds it.
  beforeChange: ({ data }) => ({ ...data, email: data.email.toLowerCase() }),
});
```

The app has one use case family. Generated and hand-written use cases extend it, and share its guards and logging.

```ts
// examples/crm/src/app/use-cases/context.ts
import { family } from '@latticecms/core';
import type { UseCase } from 'hexok';
import { z } from 'zod';

/** Who is calling. The edge builds it; real auth arrives in Phase 2. */
export const actorSchema = z.object({ userId: z.string().min(1) });

/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
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

### `collection(slug, { schema, tenant? })`

Returns a `Collection` with `slug`, `schema`, `tenant`, `output`, `events` and `hooks()`. `output` is the stored document's schema: the collection's schema plus `id`, `createdAt`, `updatedAt` and the tenant field.

- `schema` is a `z.object()`. Unknown keys are stripped.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names.
- No `z.date()` and no transforms, anywhere in the schema. Store ISO strings (`z.iso.datetime()`). Normalize in a `beforeChange` hook. `collection()` throws at definition time, and a top-level Date or reserved name fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings.
- `tenant: 'organizationId'` makes the collection tenanted; see [Tenancy](#tenancy). Without it, the collection is global.

### Hooks

`.hooks({ beforeChange?, afterRead? })` returns the same collection with those hooks. A later call replaces a hook it names.

- `beforeChange({ data, operation, previous? })` runs after validation, before the write, on create and update. `data` is the whole document after the change, without system fields. It returns the data to store.
- `afterRead({ doc })` runs on every document a generated operation returns. It does not change what is stored or what events carry.

### `family({ actor, actorId, tenantOf? })`

Builds the app's one hexok `UseCase.context` family. A caller passes `{ actor, logger }` (`CallContext<Actor>`): the actor, and a `@hexok/logger` `Logger` for the call. Lattice adds `access`, the call's access, so a use case receives `{ actor, logger, access }` (`FamilyContext<Actor>`).

- Before `execute`, the actor must parse against `actor`, the input against the use case's `input` static, and access must allow the use case's action. A bad actor is `UNAUTHORIZED`, bad input is `VALIDATION`, and a refusal is `FORBIDDEN`.
- `actorId` names the id that log lines and collection events carry. The family exposes `actor`, `actorId` and `tenantOf`, so hand-written code calls `AppUseCase.actorId(ctx.actor)`.
- `tenantOf` names the actor's tenant id, or `tenancy.bypass`. A framework with a tenanted collection requires it; see [Tenancy](#tenancy).
- Every call writes one line through a child of `ctx.logger` with `collection`, `action`, `actorId`, `tenantId` (or `tenancy: 'bypass'`) and `durationMs`.
- A hand-written use case extends the family with a `collection` static, and `input` and `output` schemas for a method. Its token is `<slug>.<name>`.

`FamilyContext<Actor>` is the context type a use case receives, and `CallContext<Actor>` the one a caller passes. `Family<Actor, Tenanted>` is the family's type; `Tenanted` is true when it has `tenantOf`.

### `framework()`, `.collection()` and `build()`

`framework({ family, errors? })` starts a definition. `errors` is the app's `{ declared, map }`; an app with no domain errors leaves it out.

`.collection(C, { access, methods?, overrides? })` adds a collection. Its slug becomes a contract slice with `find`, `get`, `create`, `update` and `delete`. `access` is required; see [Access](#access).

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

- `methods` and `overrides` are factories, `({ repos }) => instances`, keyed by slug and then name. Each is required exactly when a collection declared one.
- `access` replaces the functions given at `.collection()` with another `Access` adapter.
- `app` adds a fresh `access` to each call's context. A direct caller gets one from `context()`. Access answers are kept on the context, so make one per call or per job.
- `events` must take every collection's events. One that cannot is a compile error that names each refused token.
- `Framework<Actor, D, E>` is the definition's type.

### Access

Access decides what a call may see and change. It is a filter in the query: Lattice never loads a row and then decides whether the caller may see it.

`.collection(C, { access })` takes one function per action: `read` (find and get), `create`, `update`, `delete`, and one per method.

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

`Access` is the hexok port behind this. `build({ access })` takes another adapter of it. Its `check({ actor, collection, action, data? })` returns `boolean` or a `Where`; `action` is `find`, `get`, `create`, `update`, `delete` or a method's name, and `data` is passed for `create` only.

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
| array, object, anything else | `exists` |

- Several fields or operators must all match. `and` and `or` nest. Null and missing follow MongoDB's semantics.
- `contains` is a case-insensitive substring, never a regex.
- `sort` is an array such as `['-createdAt', 'title']`. Only required, non-null string, number and enum fields sort. The default is `['-createdAt']`, and `id` is always the last tiebreak.
- `limit` is 1 to 100, default 20. `next` is an opaque cursor for `after`, or null on the last page.
- A field or operator the schema does not allow is a type error and `VALIDATION`.

### Errors

Every procedure declares `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404 with `{ collection, id }`) and `CONFLICT` (409 with `{ collection, id }`), plus the app's declared errors. `VALIDATION` is ts-pf's protocol code, with `{ path, message }[]` issues.

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

`Repo<C>` is a typed view of the store for one collection: `get`, `getMany`, `find`, `insert`, `update` and `remove`. `insert` stamps `id`, `createdAt` and `updatedAt`; `update` bumps `updatedAt`. It runs no validation, no hooks and no events. Use it in hand-written use cases and event handlers.

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

`CollectionStore` is the hexok port every collection uses: `find`, `get`, `getMany`, `insert`, `update` and `remove`. A `where` on a single-row call limits the rows it can touch; a row outside it acts as missing. `MemoryStore` is the in-memory adapter, for tests and examples. It stores copies.

## Guarantees

The tests prove each of these.

- A client of the contract needs no type annotations at the call site.
- An override keeps the contract's types, and a method adds a typed procedure.
- Each call writes one log line. Each refusal is logged once, whether the call came over RPC, in process, or through `useCases`.
- No use case runs when access says `false`, and no row outside an access `Where` is read, changed or returned.
- Each access function runs once per call.
- No call reaches another tenant's rows, and every bypassed call is logged.
- Events publish only after a successful write.
- An update patch never resets a field to its default.
- On update, the merged document is validated with the whole schema.

## Not yet

MongoDB, relations and auth arrive in later phases. See the [phase table](../../docs/architecture.md#phased-build-plan).
