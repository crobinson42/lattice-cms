# Method

A method is a procedure of the collection's own: an action the generated operations do not have, such as closing a deal. It is a hand-written use case in the app's family, with its own input and output, and a `summary` and `effect` that describe it to MCP, OpenAPI and the admin.

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
/** Wins or loses a deal, once, and publishes DealClosed. */
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
  constructor(
    private readonly deps: {
      deals: Repo<typeof Deals>;
      events: DomainEventPublisher;
    },
  ) {
    super();
  }
```

## How to write one

- The token is `<slug>.<name>`. The name is not a generated operation, `read`, a relation, a ts-pf implementer key, or dotted.
- `input` and `output` are Zod schemas. A method that returns the collection's documents uses `C.clientOutput`, so masking applies. Read [masking.md](masking.md).
- `summary` is one sentence on what it does. `effect` is `read`, `write` or `destructive`. MCP turns them into the tool's description and hints, and the admin shows the method as an action: a document action when its input has `id`.
- Access has a function named after the method. The use case asks for its scope with that name:

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
    const scope = await ctx.access.scope(Deals, 'close');
    const deal = await this.deps.deals.get(input.id, scope);
    if (deal === null) throw notFound(input.id);
    if (deal.closedAt !== undefined) {
      throw DomainError.AlreadyClosed({ id: input.id });
    }
```

- A domain refusal, such as `AlreadyClosed`, is a member of the app's `Errors` catalog. The app declares it in `framework({ errors: { declared, map } })`, so a client narrows on its code and data.
- A method publishes its own events: a hexok `Event` the app adds to its catalog, with the tenant in its payload.

```ts
// examples/crm/src/app/use-cases/deals/close-deal.ts
    await this.deps.events.publish(
      new DealClosedEvent({
        dealId: closed.id,
        outcome: input.outcome,
        actorId: AppUseCase.actorId(ctx.actor),
        // The deal's own tenant: a support actor cannot write, so it never
        // reaches this line.
        tenantId: closed.organizationId,
      }),
    );
```

Register it with its access, and build it from the repos:

```ts
// examples/crm/src/servers/app.ts
    methods: ({ repos }) => ({
      deals: { close: new CloseDeal({ deals: repos.deals, events }) },
      activities: {
        log: new LogActivity({ activities: repos.activities, events }),
      },
    }),
```

A client calls it like a generated procedure, with no annotations: `local.deals.close({ id, outcome: 'won' })`.

## Do not

- Do not add a method for what an override does. A different delete is an override of `delete`.
- Do not return `Deals.output`. Return `Deals.clientOutput`.
- Do not check the actor's role inside `execute`. Put it in the method's access function.
- Do not write a free-standing ts-pf procedure beside the framework. A method is the collection's procedure.

## Errors you will see

- A method without `summary` and `effect` fails `.collection()` with `'~error'`: `method "close" needs a summary and an effect: what it does, and whether it reads, writes or is destructive`. A blank `summary` throws at runtime.
- `"find" is a generated operation, an access key, a relation, a ts-pf implementer key, or has a dot`, for a bad name.
- `deals.close has no access function; it is always FORBIDDEN`, when access lacks the method.
- `Lattice: the output of "deals.close" ...` at `build()`, for an output that requires a maskable field.
