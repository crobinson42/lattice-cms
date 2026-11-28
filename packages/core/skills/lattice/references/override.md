# Override

An override is a hand-written use case that serves a generated procedure in place of Lattice's. The procedure keeps its path, input, output and meta. There are two kinds:

- **One that adds a rule** checks the input, then returns the generated operation. Use it when the operation is right except for a case it must refuse, such as an update that would close a deal.
- **One that changes what the operation does,** such as a delete that archives, writes through repos.

## An override that adds a rule

```ts
// examples/crm/src/app/use-cases/deals/update-deal.ts
import type { Doc, UpdateInput } from '@latticecms/core';
import { Deals } from '../../../domain/collections/deals.js';
import { type AppCtx, AppUseCase } from '../context.js';
import { refuseClosing } from './close-only.js';

/**
 * Replaces deals.update: the generated update, except that it cannot close
 * the deal. A closed deal is already out of its access scope.
 */
export class UpdateDeal extends AppUseCase('deals.update', {
  collection: Deals,
}) {
  constructor(
    private readonly deps: {
      update: (
        ctx: AppCtx,
        input: UpdateInput<typeof Deals>,
      ) => Promise<Doc<typeof Deals>>;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: UpdateInput<typeof Deals>,
  ): Promise<Doc<typeof Deals>> {
    refuseClosing(input);
    return this.deps.update(ctx, input);
  }
}
```

The rule is one function, which create shares:

```ts
// examples/crm/src/app/use-cases/deals/close-only.ts
import { LatticeError, type UpdateInput } from '@latticecms/core';
import type { Deals } from '../../../domain/collections/deals.js';

/**
 * A deal closes only through deals.close, which closes it once and
 * publishes DealClosed. So create and update refuse a won or lost stage,
 * and any closedAt, before they write. Typed from the deal's update input,
 * which create's input also fits, so a renamed field or stage breaks the
 * build here.
 */
export function refuseClosing(
  input: Pick<UpdateInput<typeof Deals>, 'stage' | 'closedAt'>,
): void {
  const issues = [
    ...(input.stage === 'won' || input.stage === 'lost'
      ? [{ path: ['stage'], message: 'Close a deal with deals.close' }]
      : []),
    ...(input.closedAt === undefined
      ? []
      : [{ path: ['closedAt'], message: 'deals.close sets closedAt' }]),
  ];
  if (issues.length > 0) throw LatticeError.VALIDATION({ issues });
}
```

- Declare the input as `UpdateInput<C>` for update, or `CreateInput<C>` for create, and pass it on as is.
- Take the generated operation on `deps` in the constructor, and build the instance with `generated.<slug>.<operation>` in `build()`. A relation's is `generated.<slug>.<relation>.<op>`. `generated` holds only the operations the app overrides.
- Refuse before the call, with `LatticeError.VALIDATION` at the field's path. Nothing is written.
- The generated operation keeps everything: the input parse, the access scope, hooks, `null` clears, the diff, the event and masking. The guards, the log line and the span run once, in the override's own use case.

## An override that changes the operation

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
- Publish your own events. Lattice publishes nothing for an override that writes through repos.

Register both at composition, and build them from `generated` and the repos:

```ts
// examples/crm/src/servers/rpc/contract.ts
    methods: { close: CloseDeal },
    // A deal closes only through deals.close: create and update refuse to.
    overrides: { create: CreateDeal, update: UpdateDeal, delete: ArchiveDeal },
```

```ts
// examples/crm/src/servers/app.ts
    overrides: ({ repos, generated }) => ({
      deals: {
        create: new CreateDeal({ create: generated.deals.create }),
        update: new UpdateDeal({ update: generated.deals.update }),
        delete: new ArchiveDeal({ deals: repos.deals }),
      },
    }),
```

A relation's operation is overridden under its name: `overrides: { contacts: { set: ReplaceContacts } }`.

A soft delete is this override plus a `read` filter that hides archived rows. Read [access.md](access.md).

## Do not

- Do not write a second procedure for the same story, such as `deals.archive` beside `deals.delete`. Override the one that exists.
- Do not skip the scope. A repo call with `unscoped` in an override ignores access and tenancy.
- Do not give a collection that overrides `delete` a cascading ref. The cascade would hard-delete rows the override keeps.
- Do not return a different shape. The procedure's output is fixed.
- Do not copy the generated update into an override to add a rule. Check, then return `generated`.
- Do not call `useCases.<slug>.<operation>` from an override. Its guards, log line and span would run twice.
- An overridden read takes no `populate`: population runs in the generated read.

## Errors you will see

- A class whose token or `execute` types do not match the procedure fails `.collection()` with a type error on `overrides`.
- An override with `summary` or `effect` fails with `'~error'`, and throws `override "deals.delete" keeps the generated summary and effect; remove its summary and effect statics`.
- `"archive" is not a generated operation or a relation`, for an override key that names nothing.
- A missing `overrides` factory at `build()` is a type error: it is required exactly when a collection declares one.
