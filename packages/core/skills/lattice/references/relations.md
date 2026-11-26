# Relations

Lattice has no joins. A relation is an id in one document, and population reads the other collection once per call.

- `ref(slug)` marks a string field as another document's id. `z.array(ref(slug))` is a list of ids. A ref refuses an empty id, "Choose the company", so a required ref needs no `.min(1)`.
- `many(target, { through, fields? })` links each document to many of another collection, through a join collection Lattice derives.

```ts
// examples/crm/src/domain/collections/deals.ts
  schema: z.object({
    // The messages are what a form shows at the field.
    title: z.string().min(1, 'Enter a title'),
    // An archived deal still refers to its company, so it restricts too.
    companyId: ref('companies'),
```

```ts
// examples/crm/src/domain/collections/deals.ts
  // The people on a deal, and what each is to it. A contact on a deal
  // cannot be deleted: restrict, the default.
  relations: {
    contacts: many('contacts', {
      through: 'deal_contacts',
      fields: z.object({ role: contactRole }),
    }),
  },
```

## Refs and onDelete

`ref(slug, { onDelete })` says what the generated delete of the referenced document does:

| `onDelete` | When the referenced document is deleted |
| --- | --- |
| `restrict` (default) | The delete is `REFERENCED` (409), naming the collection and field, while any document refers to it |
| `cascade` | The referring documents are deleted too. A list of ids cannot cascade |
| `nullify` | The ref is cleared. A required ref cannot nullify |

- These steps skip access, stay inside the parent's tenant, and run in one store transaction. Events publish after the commit.
- A write does not check that the referenced document exists. Deleting it is where refs are kept whole.
- Each ref gets an index, led by the tenant field.
- `onDelete` runs in the generated delete only. An override of `delete` keeps the row, so its collection cannot have a cascading ref.

## many() relations

- The join collection is `Deals.relations.contacts.through`, with slug `deal_contacts`. Its documents are `{ dealsId, contactsId, ...fields }` with the parent's tenant. It has events, which the app lists in its catalog, and a repo, but no slice of its own.
- `deals.contacts.list({ id })` pages a deal's links, under the deal's `read` access.
- `deals.contacts.set({ id, links })` replaces them all, under the deal's `update` access. It diffs in one transaction, and each change publishes its join event.

```ts
// examples/crm/src/domain/events/domain-events.ts
  dealContactsCreated: Deals.relations.contacts.through.events.created,
  dealContactsUpdated: Deals.relations.contacts.through.events.updated,
  dealContactsDeleted: Deals.relations.contacts.through.events.deleted,
```

## Population

A read takes `populate`, and the output type follows it on every ts-pf client:

```ts
// examples/crm/src/servers/app.test.ts
const got = await local.contacts.get({
  id: ada.id,
  populate: ['companyId'],
});

expectTypeOf(got.companyId).toEqualTypeOf<
  Doc<typeof Companies> | Withheld
>();
```

- `get` populates refs and relations. `find` populates refs only.
- A document the caller may not read, or one that is gone, is `Withheld`: `{ id }` only. Narrow with a field: `'name' in got.companyId`.
- Population runs under the caller's `read` access on the target, with its tenant. One level deep.
- An overridden read takes no `populate`.

## Do not

- Do not load related documents in a loop in a use case. Use `populate`, or one `getMany`.
- Do not store a copy of the other document. Store its id.
- Do not relate a collection to itself with `many()`. It is not supported.
- Do not cast a populated field. Narrow `Doc | Withheld` with `in`.

## Errors you will see

- A ref to a slug that is not in the framework fails `.contract` and `build()` with `'~error'`, and throws `deals.companyId refers to "companys", which is not a collection of this framework`.
- `"<field>" is a list of ids; it cannot cascade (use restrict or nullify)`, and `"<field>" is required; nullify needs it .optional() or .nullable()`.
- `deals overrides delete, so deals.<field> cannot cascade; use restrict or nullify`.
- `relation "<name>" has the name of a field, an action or an access key`.
- At runtime, deleting a referenced document is `REFERENCED` with `{ collection, id, by: { collection, field } }`. When a `many()` relation's links refer to it, `by` names the join collection, and `by.relation` names the relation: `{ collection: 'deals', name: 'contacts' }`. A relation on `find`'s `populate` is `VALIDATION`.
