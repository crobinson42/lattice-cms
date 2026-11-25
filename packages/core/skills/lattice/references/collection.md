# Collection

A collection is a slug and a `z.object()` schema. `collection(slug, options)` returns a declaration: no store, no actor, no use case. The framework compiles it.

```ts
// examples/crm/src/domain/collections/companies.ts
import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Companies = collection('companies', {
  schema: z.object({
    name: z.string().min(1),
    domain: z.string().optional(),
    industry: z.string().optional(),
    phone: z.string().optional(),
  }),
  // Each organization sees and changes only its own rows.
  tenant: 'organizationId',
});
```

Lattice adds `id`, `createdAt` and `updatedAt` to every document, and the tenant field to a tenanted one. Put one collection in one file under `domain/collections/`.

## How to write one

- The slug is lower snake case and plural: `deal_contacts`. It names the store collection, the contract slice and the events (`deals.created`).
- `tenant: 'organizationId'` makes the collection tenanted. Leave it out for a collection every tenant shares. Read [tenancy.md](tenancy.md).
- `label: { singular, plural }` says how the collection reads mid-sentence, in summaries and the admin. Without it, the label comes from the slug: `deal_stages` reads "deal stage". Declare it when the singular would be wrong, as for `people`.
- `indexes` lists the indexes `build().ensure()` creates. Name fields as stored, system and tenant fields included. A tenanted index leads with the tenant field. Lattice adds one per ref; declare the rest.
- The admin titles a document by its first required, unmasked string field named `name`, `title`, `label` or `email`, in lists and pickers.
- `.hooks({ beforeChange, afterRead })` transforms data and nothing else.
- Make a field `.optional()` when a user may clear it. Generated update takes `null` to clear it, and the admin sends `null` when the field is emptied. A required or defaulted field cannot be cleared.

```ts
// examples/crm/src/domain/collections/deals.ts
  // The pipeline view: one organization's deals in a stage, newest first.
  indexes: [{ fields: { organizationId: 1, stage: 1, createdAt: -1 } }],
```

```ts
// examples/crm/src/domain/collections/memberships.ts
  // The edge's lookup, and one membership per pair.
  indexes: [{ fields: { userId: 1, organizationId: 1 }, unique: true }],
```

A hook normalizes what the store keeps:

```ts
// examples/crm/src/domain/collections/contacts.ts
}).hooks({
  // One spelling per address, so a where on email finds it.
  beforeChange: ({ data }) => ({ ...data, email: data.email.toLowerCase() }),
});
```

## Registering it

A new collection is three edits besides its file: an import and `.collection(C, { access })` in the composition, and its three events in the app's catalog. `lattice collection <slug>` makes all three, with a test. Read [cli.md](cli.md).

```ts
// examples/crm/src/domain/events/domain-events.ts
  companiesCreated: Companies.events.created,
  companiesUpdated: Companies.events.updated,
  companiesDeleted: Companies.events.deleted,
```

A collection missing from the catalog fails to compile at `build()`: the publisher does not take its events.

## Do not

- Do not store a `z.date()` or use a transform. Store ISO strings (`z.iso.datetime()`), and normalize in `beforeChange`.
- Do not name a field `id`, `createdAt`, `updatedAt`, `and` or `or`, or the tenant field. Core lists them in `reservedFields`.
- Do not name a field with a `.`, a leading `$`, or `_id`. MongoDB would read it as a path, an operator or the id.
- Do not name a slug `use`, `router`, `middleware`, `useAfter` or `$context`. Core lists them in `reservedNames`.
- Do not put rules in a hook. A rule that refuses a write belongs in an override.

## Errors you will see

A wrong option is a compile error on `collection()`. TypeScript reports a missing `'~error'` property, and its type is the reason:

```text
Property ''~error'' is missing in type '{ schema: ...; tenant: "organizationId"; }' but required in type '{ readonly '~error': "tenant \"organizationId\" is stamped by Lattice; it cannot be a schema field, a reserved name or an invalid field name"; }'.
```

The same checks throw at runtime, with `Lattice:` and the same words:

- `"createdAt" is a reserved field name`
- `"closedAt" is a Date; store an ISO string (z.iso.datetime())`
- `"<path>" has a transform; use a beforeChange hook`
- `an index on "deals" names "stag", which is not a field`
- `"router" is a ts-pf implementer key`, and `"deals" is already a collection`, at `.collection()`

A catalog that lacks the collection fails `build()` to compile: `'~error'` reads `the events publisher does not take "notes.created"`.
