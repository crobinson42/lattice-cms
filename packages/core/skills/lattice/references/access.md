# Access

Access decides what a call may see and change. It is a filter in the query. Lattice never loads a row and then decides whether the caller may see it.

A collection's access functions attach at composition, beside its methods and overrides:

```ts
// examples/crm/src/servers/rpc/contract.ts
/** Any signed-in caller may do this. The edge has already checked the actor. */
const anyone = () => true;

// An archived deal is hidden from every read and can no longer change.
const live = () => ({ archived: { eq: false } });
```

```ts
// examples/crm/src/servers/rpc/contract.ts
  .collection(Deals, {
    access: {
      read: live,
      create: anyone,
      update: live,
      delete: live,
      close: live,
    },
```

## How it works

- `access` has one function per action: `read` (find, count and get), `create`, `update`, `delete`, and one per method.
- Each function receives `{ actor }`, typed by the family's actor schema. `create` also receives `data`, its parsed input.
- `read`, `update`, `delete` and a method return `boolean` or a `Where` on the collection's documents, or a promise of one. `create` returns `boolean`.
- `true` allows every row. `false` refuses the call with `FORBIDDEN`. A `Where` limits the call to the rows that match: a row outside it is `NOT_FOUND` on get, update and delete, and `find` never returns it.
- It fails closed. A missing function denies, and `access: {}` denies everything. An override uses the function of the action it replaces.
- An access `Where` is ANDed with the caller's `where` and the tenant clause. A caller can only narrow it.

A filter on the actor reads only the caller's own rows:

```ts
// examples/crm/src/servers/rpc/contract.ts
  .collection(Memberships, {
    // A caller lists its own memberships, in every organization. An
    // organization switcher uses /auth organizations instead, since /rpc
    // needs an organization first. No create, update or delete: only
    // trusted code writes them.
    access: { read: ({ actor }) => ({ userId: { eq: actor.userId } }) },
  })
```

A soft delete is a `read` filter, as `live` is above, with an override of `delete`. Read [override.md](override.md).

## In a hand-written use case

The family checks access before every `execute`: generated operations, overrides and methods. A hand-written use case gets the same filter with `ctx.access.scope(C, action)` and passes the `Scope` to every repo call:

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
    const scope = await ctx.access.scope(Deals, 'close');
    const deal = await this.deps.deals.get(input.id, scope);
```

A deal outside the scope is `null` there, as it is `NOT_FOUND` to a client.

## Do not

- Do not load a document and then check the actor against it. Return a `Where` instead.
- Do not pass `unscoped` from a use case that acts for a caller. It skips access and tenancy.
- Do not put authentication in an access function. The edge proves the caller. Access sees the actor it built.
- Do not filter by a maskable field. A `Where` on `amount` reveals a bound on hidden values.

## Errors you will see

- A `Where` that names a field the collection lacks does not compile: TypeScript says the object is not assignable to `boolean | Where<...>`.
- A key that is not an action or a method fails `.collection()` with `'~error'`: `"publish" is not an action of deals`.
- A method with no access function fails with `deals.close has no access function; it is always FORBIDDEN`.
- At runtime, a refusal is `FORBIDDEN`, logged once, and a row outside the filter is `NOT_FOUND`.
