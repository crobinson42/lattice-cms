---
'@latticecms/store-mongo': minor
---

Peers on `@latticecms/core` 0.8. `ensure()` over an index that differs and holds the declared index's default name, such as `email_1`, throws an `Error` that names it and says to drop it in a migration. The driver's error is its `cause`. An index with the declared keys, `unique` and `present`, under another name or with options Lattice does not declare, such as a TTL, now counts as ensured, where it threw before.
