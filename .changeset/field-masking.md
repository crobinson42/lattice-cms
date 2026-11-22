---
'@latticecms/core': minor
---

Field-level read masking. `collection(slug, { maskable: ['amount'] })` names fields a caller's rules may withhold, and `.collection(C, { fields: { amount: { read: ({ actor }) => … } } })` gives each its rule, required exactly when a collection has one. A withheld field is left out of every procedure's output (generated reads and writes, populated documents, overrides and methods), and a `where` or `sort` on it is `VALIDATION`. Client types have maskable fields optional; `Collection.clientOutput` and the new `ClientDoc<C>` type name that document, and `Doc<C>`, repos, direct `useCases` calls and events keep the whole one. The `Access` port gains `readable({ actor, collection, fields })`, so a custom adapter decides masking too; a field it leaves out is withheld. A method output that holds a maskable field where it is required, or that Lattice cannot see through, throws at `build()`.
