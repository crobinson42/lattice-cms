---
status: accepted
strength: default
date: 2026-11-21
revisit: npm or Node gains a reliable way to share one copy of a regular dependency with the app, or hexok and ts-pf stop exposing classes and branded types that must be the app's own.
---

# 0029. hexok and ts-pf are peers of every `@latticecms/*` package

## Decision

- `hexok` and the `@ts-pf/*` packages that `@latticecms/core` imports are `peerDependencies` of core, with caret ranges on one hexok major and one ts-pf minor. They are also `devDependencies`, for the package's own tests. The same applies to `hexok` in `@latticecms/store-mongo`.
- An adapter package's peer range on `@latticecms/core` is a caret range on the current version, never `*`. Changesets rewrites the range and patches the adapter when a core release leaves the range.
- A driver that only the adapter uses, such as `mongodb`, stays a regular dependency ([0025](0025-mongo-store-owns-its-client.md)).
- Every `@latticecms/*` package publishes with `access: public`.

## Why

Lattice's public types are hexok and ts-pf types. `build()` returns real `UseCase`s and a ts-pf `router`, `Access` is a hexok `Port`, and the app imports the same packages for its own use cases, errors and server. Two copies give two `Port` and `UseCase` classes, so class identity and type checks fail with errors that name neither package. A peer makes the app own the one copy, and npm reports a range mismatch at install.

## Rejected

- **Regular dependencies, as hexok's own adapters declare `hexok`.** It is simpler to install, but npm dedupe is the only thing keeping one copy. A mismatched range silently installs a second copy.
- **`*` on core.** It accepts a core that has broken the adapter's assumptions. Changesets 3 no longer turns a peer bump into a major release, so a caret range costs nothing.
- **Restricted access.** It needs a paid npm org and a read token in every deploy. hexok and ts-pf publish public.
