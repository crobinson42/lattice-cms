---
'@latticecms/core': minor
---

The store adapter surface. `CollectionStore` gains `count(collection, where?)` and `ensure(collection, indexes)`, and `MemoryStore` implements both, enforcing unique indexes as MongoDB does. `@latticecms/core/store` exports what an adapter needs: the port, its types, `AnyWhere`, `FieldOps` and the cursor helpers. `@latticecms/core/store/conformance` exports `storeCases`, the cases every store passes in any test runner.
