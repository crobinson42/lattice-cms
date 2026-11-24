# Tenancy

A collection with `tenant: 'organizationId'` keeps each tenant's rows apart. Lattice adds the field to the output, stamps it on create, and filters every call by the caller's tenant. A collection without `tenant` is global.

The family says each call's tenant:

```ts
// examples/crm/src/app/use-cases/context.ts
/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    'support' in actor ? tenancy.bypass : actor.organizationId,
});
```

## How it works

- `tenantOf` returns the actor's tenant id, or `tenancy.bypass` for a platform actor such as support staff. A framework with a tenanted collection requires it.
- The tenant field is in `Doc` and `Where`, never in create or update input. Create stamps it after `beforeChange`. Update never writes it.
- Every scope is the tenant clause ANDed with the access `Where`. Another tenant's row is `NOT_FOUND`, and `find` never returns it, page after page.
- A bypassed call reads across tenants and writes nothing on a tenanted collection: generated create, update and delete are `FORBIDDEN`, and so is a repo write through its scope. Each bypassed scope writes one `tenancy.bypass` log line.
- The actor schema validates the bypass flag. The edge sets it from server config, never from the request.

The crm proves isolation over HTTP:

```ts
// examples/crm/src/servers/http/tenancy.test.ts
    // An id from another organization is not there at all.
    expect(await code(a, 'companies/get', { id: bolt })).toBe('NOT_FOUND');
    expect(await code(b, 'companies/get', { id: acme })).toBe('NOT_FOUND');
    // A where on the tenant field cannot reach past the tenant filter.
    expect(
      await ok(a, 'companies/find', {
        where: { organizationId: { eq: 'org-b' } },
      }),
    ).toMatchObject({ docs: [] });
```

## Server code names its tenant

Code that acts for no caller says which tenant it works in. An event handler reads with `tenancy.scope(C, tenantId)`: the tenant clause, and no access. An insert through it is stamped with that tenant.

```ts
// examples/crm/src/app/event-handlers/deal-closed-integration.ts
    const { dealId, outcome, tenantId } = event.payload;
    const deal = await this.deps.deals.get(
      dealId,
      tenancy.scope(Deals, tenantId),
    );
```

`unscoped` reads and writes every tenant. A script that acts for no tenant passes it. It cannot insert into a tenanted collection, since the row would belong to no tenant.

A global collection, such as the crm's `organizations` and `memberships`, has no tenant field. Its `read` access does the narrowing:

```ts
// examples/crm/src/servers/rpc/contract.ts
  .collection(Organizations, {
    // A member reads the organization it acts in, and support every one.
    // No create, update or delete: only trusted code writes them.
    access: {
      read: ({ actor }) =>
        'support' in actor ? true : { id: { eq: actor.organizationId } },
    },
  });
```

## Do not

- Do not put the tenant field in the schema. Lattice adds it.
- Do not take the tenant from the request body. The edge checks membership and puts the tenant on the actor.
- Do not pass `unscoped` in an event handler. Use the event's `tenantId` with `tenancy.scope`.
- Do not write through a bypass. Support reads; a write is a separate, audited path.

## Errors you will see

- A schema field with the tenant's name fails `collection()` with `'~error'`: `tenant "organizationId" is stamped by Lattice; it cannot be a schema field, a reserved name or an invalid field name`.
- A tenanted collection in a family without `tenantOf` fails `.collection()`: `"notes" is tenanted, but the family has no tenantOf`.
- `insert` with `unscoped` on a tenanted collection does not compile, and throws `"notes" is tenanted, so insert needs a scope with a tenant, such as tenancy.scope()`.
- At runtime, a bypass write is `FORBIDDEN`, and another tenant's row is `NOT_FOUND`.
