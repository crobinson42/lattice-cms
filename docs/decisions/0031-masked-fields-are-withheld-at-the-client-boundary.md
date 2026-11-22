---
status: accepted
strength: default
date: 2026-11-21
revisit: An app needs a field's visibility to depend on the row, not just the actor, or a client generator cannot handle optional properties in output.
---

# 0031. Masked fields are declared on the collection, decided per actor through the Access port, and withheld at the client boundary

## Decision

- **The collection says what may be withheld:** `collection('deals', { schema, maskable: ['amount'] })`. The collection gains `clientOutput`, which is `output` with each maskable field optional. `ClientDoc<C>` names its type. `Doc<C>` stays whole.
- **Composition says who may read it:** `.collection(Deals, { access, fields: { amount: { read: ({ actor }) => … } } })`. `fields` is required exactly when a collection has maskable fields, with one rule per field. A rule sees the actor only, and is decided once per call.
- **The Access port decides.** The port's `readable({ actor, collection, fields })` returns the readable subset, and anything it leaves out is withheld. The default adapter answers from `fields`.
- **Masking happens where a document leaves for a client:** the implemented router. That covers generated operations, overrides, methods, population, and the documents create and update return. A withheld field is absent. Repos, direct `useCases` and events' `doc` are server code, and are never masked. A document leaves the product through webhooks, which map it to their own payload.
- **Maskable fields are found by a marker on the field schema,** so a clone such as `pick` or `extend` is still found. A required maskable field in a procedure's output, or a schema the walk cannot see through, is a throw at build.
- **No queries on what the caller cannot read.** The family guard refuses a `where` or `sort` that names a field withheld from the caller as `VALIDATION`, with the field's path. That covers find, count, and any operator at any depth. A unique index on a maskable field throws at `collection()`.

## Why

Output types cannot follow the actor, so an optional field is the honest type, and every client generator handles it. Masking cannot live in the family: hexok's hooks cannot change a result, and 0023 rejected wrapping instances. The router is the one place every client call passes. A query on a withheld field would reveal its value by bisection.

## Rejected

- **Per-row rules.** A field visible on some rows could never be filtered or sorted, by anyone, without leaking. And the rule runs once per document.
- **A `Withheld` marker per field.** Every use has to narrow, arithmetic breaks, and OpenAPI gets a `oneOf` per field.
- **A separate read per field.** A list cannot show the field, and the contract grows per field.
- **Types computed only in the contract.** A method's output would claim the field is required.
- **Rules outside the Access port.** An authz adapter could not govern masking.
- **Masking in generated use cases only.** Overrides and methods would skip it.
- **Masking events.** Their handlers are system code, and the writer's rules say nothing about who handles them.
- **Ignoring, or answering `FORBIDDEN` to, a `where` on a withheld field.** Ignoring it returns rows the caller did not ask for. `FORBIDDEN` cannot name the field.
