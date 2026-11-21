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

/** The CRM's API: three collections, one override and one method. No ports. */
export const crm = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError },
})
  .collection(Companies)
  .collection(Contacts)
  .collection(Deals, {
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

### `collection(slug, { schema })`

Returns a `Collection` with `slug`, `schema`, `output`, `events` and `hooks()`. `output` is the stored document's schema: the collection's schema plus `id`, `createdAt` and `updatedAt`.

- `schema` is a `z.object()`. Unknown keys are stripped.
- `id`, `createdAt`, `updatedAt`, `and` and `or` are reserved field names.
- No `z.date()` and no transforms, anywhere in the schema. Store ISO strings (`z.iso.datetime()`). Normalize in a `beforeChange` hook. `collection()` throws at definition time, and a top-level Date or reserved name fails to compile.
- `createdAt` and `updatedAt` are ISO 8601 strings.

### Hooks

`.hooks({ beforeChange?, afterRead? })` returns the same collection with those hooks. A later call replaces a hook it names.

- `beforeChange({ data, operation, previous? })` runs after validation, before the write, on create and update. `data` is the whole document after the change, without system fields. It returns the data to store.
- `afterRead({ doc })` runs on every document a generated operation returns. It does not change what is stored or what events carry.

### `family({ actor, actorId })`

Builds the app's one hexok `UseCase.context` family. Its context is `{ actor, logger }`: the actor, and a `@hexok/logger` `Logger` for the call.

- Before `execute`, the actor must parse against `actor` and the input against the use case's `input` static. A bad actor is `UNAUTHORIZED`; bad input is `VALIDATION`.
- `actorId` names the id that log lines and collection events carry. The family exposes `actor` and `actorId`, so hand-written code calls `AppUseCase.actorId(ctx.actor)`.
- Every call writes one line through a child of `ctx.logger` with `collection`, `action`, `actorId` and `durationMs`.
- A hand-written use case extends the family with a `collection` static, and `input` and `output` schemas for a method. Its token is `<slug>.<name>`.

`FamilyContext<Actor>` is the context type. `Family<Actor>` is the family's type.

### `framework()`, `.collection()` and `build()`

`framework({ family, errors? })` starts a definition. `errors` is the app's `{ declared, map }`; an app with no domain errors leaves it out.

`.collection(C, { methods?, overrides? })` adds a collection. Its slug becomes a contract slice with `find`, `get`, `create`, `update` and `delete`.

- `methods: { name: Class }` adds a procedure. `overrides: { action: Class }` replaces a generated one.
- Each class must name `C` and its token, and its `execute` must take and return the procedure's types. A mismatch, a reserved name, or a slug added twice is a compile error and a runtime throw.

`.contract` is the ts-pf contract, built once on first read. `Contract<E, D>` is its type.

`build({ store, events, methods?, overrides? })` wires the definition and returns:

| Output | What it is |
| --- | --- |
| `app` | The implemented ts-pf router, for `FetchHandler` and `createLocalClient` |
| `useCases` | The hexok instance that serves each procedure: generated, override or method, each typed precisely |
| `repos` | A `Repo<C>` per collection: the objects the factories received |
| `onError` | `onError(logger)` for `FetchHandler` |

- `methods` and `overrides` are factories, `({ repos }) => instances`, keyed by slug and then name. Each is required exactly when a collection declared one.
- `events` must take every collection's events. One that cannot is a compile error that names each refused token.
- `Framework<Actor, D, E>` is the definition's type.

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

`collection()` derives three hexok `Event` classes: `Contacts.events.created`, `.updated` and `.deleted`, with tokens `contacts.created` and so on. Payloads are `{ doc, actorId }`, and `{ doc, previous, actorId }` on update, typed from the schema. `doc` is the stored document.

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
    _ctx: AppCtx,
    input: { id: string },
  ): Promise<Doc<typeof Deals>> {
    const deal = await this.deps.deals.update(input.id, { archived: true });
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
- Events publish only after a successful write.
- An update patch never resets a field to its default.
- On update, the merged document is validated with the whole schema.

## Not yet

MongoDB, relations, access rules, tenancy and auth arrive in later phases. See the [phase table](../../docs/architecture.md#phased-build-plan).
