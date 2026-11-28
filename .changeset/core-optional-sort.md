---
'@latticecms/core': minor
---

`sort` takes optional and nullable string, number and enum fields. A document with no value, missing or null, comes after every document with one, ascending or descending, and documents with no value order by the remaining keys, then `id`. The cursor records a missing value as `null`, so pages stay stable across the boundary.

For store adapters: `FindQuery` has a new required `optional`, the sort fields a document may lack, and `orderOf(sort, optional)` takes it. Each `Order` key says whether it is optional, and `after`, `encodeCursor` and the new `cursorValues` handle a missing value. The conformance suite has cases for it.
