---
'@latticecms/core': minor
---

`Repo.insert` takes `z.input` of the collection's schema and parses it before stamping, as create does: defaults apply, unknown keys are dropped, and a failed check throws `VALIDATION` with create's issue shape. It still runs no hooks, no events and no access. The tenant still comes from the scope. `Repo.update` is unchanged.
