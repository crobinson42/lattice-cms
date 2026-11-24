# Override

An override is a hand-written use case that serves a generated procedure in place of Lattice's. Use one when the story changes what an operation does, such as a delete that archives. The procedure keeps its path, input, output and meta.

```ts
// examples/crm/src/app/use-cases/deals/archive-deal.ts
import { type Doc, LatticeError, type Repo } from '@latticecms/core';
import { Deals } from '../../../domain/collections/deals.js';
import { type AppCtx, AppUseCase } from '../context.js';

/** Replaces deals.delete: the deal is archived, and the row stays. */
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

## How to write one

- Extend the app's family with the procedure's token, `<slug>.<action>`, and a `collection` static. Declare no `summary` or `effect`: an override keeps the generated ones.
- Take repos on `deps` in the constructor. Annotate `execute` with the procedure's input and output types.
- Get the scope with `ctx.access.scope(C, action)`. The family has already checked access for the action. The override uses that action's access function.
- Refuse as the generated operation does: `LatticeError.NOT_FOUND`, `CONFLICT` or `REFERENCED`. A domain refusal is a member of the app's own `Errors` catalog, declared in `framework({ errors })`.
- Publish your own events. Lattice publishes nothing for an override.

Register it at composition, and build it from the repos:

```ts
// examples/crm/src/servers/rpc/contract.ts
    methods: { close: CloseDeal },
    overrides: { delete: ArchiveDeal },
```

```ts
// examples/crm/src/servers/app.ts
    overrides: ({ repos }) => ({
      deals: { delete: new ArchiveDeal({ deals: repos.deals }) },
    }),
```

A relation's operation is overridden under its name: `overrides: { contacts: { set: ReplaceContacts } }`.

A soft delete is this override plus a `read` filter that hides archived rows. Read [access.md](access.md).

## Do not

- Do not write a second procedure for the same story, such as `deals.archive` beside `deals.delete`. Override the one that exists.
- Do not skip the scope. A repo call with `unscoped` in an override ignores access and tenancy.
- Do not give a collection that overrides `delete` a cascading ref. The cascade would hard-delete rows the override keeps.
- Do not return a different shape. The procedure's output is fixed.
- An overridden read takes no `populate`: population runs in the generated read.

## Errors you will see

- A class whose token or `execute` types do not match the procedure fails `.collection()` with a type error on `overrides`.
- An override with `summary` or `effect` fails with `'~error'`, and throws `override "deals.delete" keeps the generated summary and effect; remove its summary and effect statics`.
- `"archive" is not a generated operation or a relation`, for an override key that names nothing.
- A missing `overrides` factory at `build()` is a type error: it is required exactly when a collection declares one.
