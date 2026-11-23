---
'@latticecms/core': minor
---

Two more catalog facts, so a client reads them instead of inferring them. The tenant field's JSON Schema has `x-lattice-tenant: true` in every output. A relation's `list` and `set` meta name its `target` collection, so `LatticeMeta`'s list and set shape gains `target`.
