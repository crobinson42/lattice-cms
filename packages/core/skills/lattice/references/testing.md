# Testing

Test a story through the contract. Build the app over a store, and call it with ts-pf's `createLocalClient`, as a client would. The local client runs the same router as HTTP: access, tenancy, masking and validation.

The smallest app, from core's quick start:

```ts
// examples/crm/src/quickstart/quickstart.ts
const client = createLocalClient(app, {
  context: { actor: { userId: 'ann' }, logger: new NoopLogger() },
});
const note = await client.notes.create({ title: 'Write the docs' });
await client.notes.update({ id: note.id, done: true });
const { docs } = await client.notes.find({ where: { done: { eq: true } } });
```

## The app's tests

The crm builds its app the way the server does, and gives the client an actor:

```ts
// examples/crm/src/servers/app.test.ts
  function setup() {
    const events = new MemoryDomainEventPublisher();
    const crm = createApp({ store: store(), events });
    const local = createLocalClient(crm.app, {
      context: { actor, logger: new NoopLogger() },
    });
    return { ...crm, events, local };
  }
```

A client needs no annotations. A refusal is a typed error:

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

- `MemoryStore` needs no server. The crm runs the same tests on `MemoryStore` and `MongoStore`, through `describe.each(backends)` in `src/test/stores.ts`.
- `build().repos` seeds and reads data directly, with a scope. `build().context({ actor, logger })` makes a context for a direct `useCases.*.execute` call. Prefer the client.
- A collection's own test, as `lattice collection` writes it, builds a one-collection framework with the app's family over `MemoryStore`, and checks the composition registered it.
- A test of a handler builds it with repos and a fake port, and calls `handle` with an event instance.
- Masking and tenancy are tested over HTTP in the crm: `src/servers/http/masking.test.ts` and `tenancy.test.ts`.

## A store adapter

A new store passes the conformance suite from `@latticecms/core/store/conformance`, with a fresh store per case:

```ts
// packages/store-mongo/src/mongo-store.test.ts
  it.each(storeCases)('$name', ({ run }) => run(store));
```

A case that needs a capability names it in `needs`. A store without transactions filters out `needs: ['transactions']`.

## Do not

- Do not test through a mock of the store or the router. `MemoryStore` is the in-memory adapter.
- Do not cast a client's result. Narrow it: `asResult`, `'field' in doc`.
- Do not call `useCases` to test what a client sees. Masking happens in the router, so `useCases` return whole documents.
- Do not share one access context across calls. Make one per call with `context()`.

## Errors you will see

- A test that expects a masked field from `useCases` passes and proves nothing. Call through `createLocalClient`.
- A tenanted collection seeded through `unscoped` does not compile. Seed with `tenancy.scope(C, tenantId)`.
