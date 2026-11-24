# Masking

Masking withholds a field from a caller whose rule says no. The collection names the fields that may be withheld. Composition says who may read each one.

```ts
// examples/crm/src/domain/collections/deals.ts
  // Only managers and support see amounts: the contract's fields rule.
  maskable: ['amount'],
```

```ts
// examples/crm/src/servers/rpc/contract.ts
    // A member sees every deal of the organization, without its amount.
    fields: {
      amount: {
        read: ({ actor }) => 'support' in actor || actor.role === 'manager',
      },
    },
```

## How it works

- `fields` is required exactly when the collection has maskable fields, with one rule per field. A rule receives `{ actor }`, is asked once per call, and returns `boolean` or a promise of one.
- A withheld field is absent from what a client receives: generated reads and writes, a relation's `list`, populated documents, overrides and methods. Masking happens in the router, on every client path: HTTP, `createLocalClient` and MCP.
- A client's type has the field optional for every caller: `deal.amount` is `number | undefined`. `ClientDoc<C>` names that document. `Doc<C>` stays whole.
- A `where` or `sort` on a field the caller may not read is `VALIDATION`, at any depth. No filter, count, order or cursor reveals it.
- Server code sees whole documents: repos, direct `useCases` calls and events' `doc`. A webhook or integration event maps the document field by field and decides what leaves.

A method that returns the collection's documents declares `output: Deals.clientOutput`, or a schema built from it:

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
  // As a client receives a deal: the amount is withheld from a member.
  output: Deals.clientOutput,
```

The crm checks it over HTTP:

```ts
// examples/crm/src/servers/http/masking.test.ts
    for (const input of [
      { where: { amount: { gt: 1000 } } },
      { sort: ['-amount'] },
    ]) {
      expect(await rpc('ann', 'deals/find', input)).toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' },
      });
    }
```

## Do not

These reveal a masked field, and masking does not catch them:

- Do not refine an object across a maskable field. Its failure depends on the hidden value.
- Do not filter access by a maskable field. The rows that exist reveal a bound.
- Do not derive another field from a masked one, in `afterRead` or a method's output.
- Do not return `Deals.output` from a method. Its maskable field is required, and build refuses it.
- Do not mask by deleting the field in a use case. Name it `maskable` and give it a rule.

A rule sees the actor, not the row.

## Errors you will see

- A collection with a maskable field and no `fields` rule fails `.collection()`, and throws `deals needs exactly one fields rule for each maskable field (amount); it has none`.
- `maskable "amout" is not a field of deals, or is named twice`.
- `deals.companyId is a ref; it cannot be maskable`, and `deals.amount is maskable, so it cannot be in a unique index: a CONFLICT would reveal its value`.
- A method output that holds a maskable field as required, or that Lattice cannot see through (`z.lazy()`, a transform, `z.custom()`, `z.unknown()`), throws at `build()`: `the output of "deals.close" ...`.
- At runtime, a query on an unreadable field is `VALIDATION`, with the message `"amount" is not readable` at its path.
