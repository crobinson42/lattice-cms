---
'@latticecms/core': minor
---

Refs. `ref(slug, { onDelete? })` marks a string field, or `z.array(ref(slug))` a list, as ids of another collection; an unknown slug fails at `build()` and on `.contract`. The generated delete runs `onDelete` (`restrict`, `cascade`, `nullify`) in one `store.transaction()`, inside the parent's tenant, publishing events after the commit; restrict refuses with the new declared code `REFERENCED` (409). Each ref gets an index in `ensure()`. `CollectionStore` gains `transaction(work)`, which `MemoryStore` implements by snapshot and restore. Arrays gain the `has` Where operator, with conformance cases. A collection that overrides `delete` cannot have a cascading ref. A conformance case may declare `needs: ['transactions']`, so a store without transactions filters it out.
