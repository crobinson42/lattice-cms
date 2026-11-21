---
status: proposed
strength: default
date: 2026-11-20
revisit: hexok use case instances carry their class statics in their type, or TypeScript resolves a class whose base expression refers back to the value that names it.
---

# 0018. Methods and overrides attach in the framework, not on the collection

## Decision

A collection is a pure declaration and names no use case classes. The app attaches custom methods and overrides where it composes: `framework().collection(Posts, { methods: { publish: PublishPost }, overrides: { delete: ArchivePost } })`. `build()` takes one instance per declared class, nested by slug, from a factory that receives the typed repos: `methods: ({ repos }) => ({ posts: { publish } })`, and the same for `overrides`.

## Why

A method class refers to its collection (`collection: Posts`, `output: Posts.output`). When the collection also refers to the class (`.method('publish', PublishPost)`), the two values cycle. The Phase 0 type spike showed it fails three ways: TS7022 on the collection, TS2506 on the class, and `Cannot read properties of undefined` when the ESM modules load. A thunk fixes the load order but not the types. Attaching at the composition site removes the cycle by construction.

The class is declared and then constructed, because a hexok instance's type does not carry its class statics, and the contract types come from those static schemas. Nesting instances by slug mirrors the contract, and it avoids parsing `'posts.publish'` keys.

## Rejected

- `.method()` and `.override()` on the collection: it reads better, but it does not compile or load.
- Attaching on the collection at the composition site (`Posts.method(...)` inside `.collection()`): two `Posts` values, and passing the plain one silently drops the method.
- A method class that names its collection by slug and imports a separate schema: every hand-written use case repeats what the collection knows, and the guards lose the collection object.
- Flat `'posts.publish'` keys in `build()`: template-literal types, and a slug that contains a dot breaks the lookup.
