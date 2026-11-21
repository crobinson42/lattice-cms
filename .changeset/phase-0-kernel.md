---
'@latticecms/core': minor
---

Phase 0 kernel, on `MemoryStore`:

- `collection()` declares a Zod 4 schema with `beforeChange` and `afterRead` hooks and derives hexok event classes for each write.
- `family()` builds the app's one hexok use case family: actor and input guards, and one log line per call and per refusal.
- `framework({ family, errors })` and `.collection()` give a typed ts-pf contract with generated `find`, `get`, `create`, `update` and `delete`, plus overrides and custom methods.
- `build({ store, events, methods, overrides })` returns the implemented router, `useCases`, `repos` and `onError`.
- `Where`, `Sort` and cursor pages; `LatticeError`; `Repo` and `Doc`; the `CollectionStore` port and `MemoryStore`.
