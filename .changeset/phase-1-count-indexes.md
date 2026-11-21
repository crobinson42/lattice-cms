---
'@latticecms/core': minor
---

Indexes and `count`. `collection(slug, { indexes })` declares indexes by the stored document's field names; an unknown field is a compile error and a throw. `build()` returns `ensure()`, which creates them through `store.ensure()` at startup. Every collection gets a generated `<slug>.count({ where? })` returning `{ count }`, under `read` access and the tenant clause; it can be overridden, and a method may not be named `count`. `Repo` has `count(where, scope)`.
