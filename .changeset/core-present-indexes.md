---
'@latticecms/core': minor
---

A unique index takes `present: ['emails']`: it covers only rows where each listed field has a value, not missing or null, and for an array, an element that is neither null nor an array. Two contacts without emails, or two rows whose optional `externalId` is unset, no longer clash. `collection()` throws when `present` is on an index that is not unique, is empty, or names a field outside the index. `MemoryStore` enforces it. A declared index with `present` does not stand in for a ref's lookup index, since MongoDB does not use it for the lookup. When it has exactly the lookup's keys, the lookup index adds `id`.

A custom `CollectionStore` should honor `Index.present` in `ensure`. One that ignores it enforces the index on every row, as before.
