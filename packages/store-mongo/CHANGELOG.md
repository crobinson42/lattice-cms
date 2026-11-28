# @latticecms/store-mongo

## 0.6.0

### Minor Changes

- [#12](https://github.com/crobinson42/lattice-cms/pull/12) [`98c24f9`](https://github.com/crobinson42/lattice-cms/commit/98c24f98a01db13f04cb9b1c0a5464f047424a01) Thanks [@crobinson42](https://github.com/crobinson42)! - Peers on `@latticecms/core` 0.6. `CONFLICT` names the clashing index's fields in `data.fields`, read from the duplicate key error's `keyPattern`, with `_id` as `id`. A server that leaves `keyPattern` out gives `fields: []`.

### Patch Changes

- Updated dependencies [[`d2badf8`](https://github.com/crobinson42/lattice-cms/commit/d2badf86801fe4b6a31300035556f9b3c2e9a959)]:
  - @latticecms/core@0.6.0

## 0.5.0

### Minor Changes

- [#10](https://github.com/crobinson42/lattice-cms/pull/10) [`fc7e0e3`](https://github.com/crobinson42/lattice-cms/commit/fc7e0e3a63ad23e092496e93312ab5f5e9600654) Thanks [@crobinson42](https://github.com/crobinson42)! - Peers on `@latticecms/core` 0.5. Upgrade core, store-mongo and the CLI together.

### Patch Changes

- Updated dependencies [[`fc7e0e3`](https://github.com/crobinson42/lattice-cms/commit/fc7e0e3a63ad23e092496e93312ab5f5e9600654)]:
  - @latticecms/core@0.5.0

## 0.4.0

### Minor Changes

- [#8](https://github.com/crobinson42/lattice-cms/pull/8) [`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f) Thanks [@crobinson42](https://github.com/crobinson42)! - Peers on `@latticecms/core` 0.4. Upgrade core, store-mongo and the CLI together.

### Patch Changes

- Updated dependencies [[`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f), [`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f)]:
  - @latticecms/core@0.4.0

## 0.3.0

### Minor Changes

- [#4](https://github.com/crobinson42/lattice-cms/pull/4) [`66d2468`](https://github.com/crobinson42/lattice-cms/commit/66d246810820613c55450be4e8ff5129265b69af) Thanks [@crobinson42](https://github.com/crobinson42)! - `nhas` translates to `$ne` on the array field, which matches when no element is equal, and matches a missing or null array. Needs `@latticecms/core` with `nhas`.

  Peers on `hexok ^2.2.8`, as core does.

### Patch Changes

- Updated dependencies [[`66d2468`](https://github.com/crobinson42/lattice-cms/commit/66d246810820613c55450be4e8ff5129265b69af)]:
  - @latticecms/core@0.3.0

## 0.2.0

### Minor Changes

- [#2](https://github.com/crobinson42/lattice-cms/pull/2) [`74c37fe`](https://github.com/crobinson42/lattice-cms/commit/74c37fe5e237f0918de593cb358b7b4da0861a3d) Thanks [@crobinson42](https://github.com/crobinson42)! - `find` sorts optional fields with missing values last, in either direction. A sort with no ascending optional key is a plain, index-served sort. When the first key is the one ascending optional key, it runs two queries: documents with a value, which an index on the field serves, then documents without one, only when the page is not full. Any other ascending optional key sorts through an aggregate with a computed key. Needs `@latticecms/core` with `FindQuery.optional`.

### Patch Changes

- Updated dependencies [[`94d5203`](https://github.com/crobinson42/lattice-cms/commit/94d5203d35bb7109b415da436c6b7c48cb930509), [`74c37fe`](https://github.com/crobinson42/lattice-cms/commit/74c37fe5e237f0918de593cb358b7b4da0861a3d), [`03059f7`](https://github.com/crobinson42/lattice-cms/commit/03059f79c707c3e71ba2f507d38f6c2611cf797e), [`e3fb0eb`](https://github.com/crobinson42/lattice-cms/commit/e3fb0ebe5e4bdb5268306b0e3f50f105977fbc90), [`1fb7e25`](https://github.com/crobinson42/lattice-cms/commit/1fb7e2508b8ab2832e92759a0da64ec96845b828)]:
  - @latticecms/core@0.2.0

## 0.1.0

### Minor Changes

- [`355f2b5`](https://github.com/crobinson42/lattice-cms/commit/355f2b5d9ec18ccd637d861abc5639ea036e7ae2) Thanks [@crobinson42](https://github.com/crobinson42)! - First release. `MongoStore`, the MongoDB `CollectionStore` for `@latticecms/core`, and `migrate()`, its data migrations runner.

  - `MongoStore` owns its `MongoClient`, with `start()` and `stop()`, and `MongoStoreError` (`NotStarted`, `Starting`, `Stopped`) for a call at the wrong time. It passes the store conformance suite.
  - Filters translate one to one into Mongo queries. A duplicate key is Lattice's `CONFLICT`. `ensure` creates indexes and never drops one.
  - `transaction(work)` runs `work` in one Mongo transaction on a replica set or mongos. On a standalone server, `work` runs in order, without atomicity.
  - `migrate(store, migrations, { logger, lock? })` runs an explicit list of forward-only data migrations once each, in id order, and records them in `_migrations`. The list is checked against what ran before anything runs. A migration may opt into a transaction. A lease in `_migrations_lock` keeps two processes from migrating at once.
  - `lattice migrate`, from `@latticecms/cli`, runs `migrate()` as a deploy step from an app's built module.
  - Each call is an OpenTelemetry client span, `{operation} {collection}`, a child of the active span, with no document value and no query text.

  Install the peers in the app: `npm install @latticecms/store-mongo @latticecms/core hexok@^2 @ts-pf/contract@^1 @ts-pf/protocol@^1 @ts-pf/server@^1 @ts-pf/docs@^1 @ts-pf/mcp@^1 zod@^4 @hexok/logger@^0.2 @opentelemetry/api@^1`. `@latticecms/core` is a peer at `^0.1.0`. The `mongodb` driver is this package's own dependency. See the [README](./README.md#install).

  Known limits, listed in [architecture.md](../../docs/architecture.md#known-limits):

  - A standalone server runs a transaction's work in order, without atomicity. Run production on a replica set.
  - String order outside the BMP, and non-ASCII case folding in `contains`, differ from `MemoryStore`. See the [README](./README.md#known-differences-from-memorystore).

### Patch Changes

- Updated dependencies [[`355f2b5`](https://github.com/crobinson42/lattice-cms/commit/355f2b5d9ec18ccd637d861abc5639ea036e7ae2)]:
  - @latticecms/core@0.1.0
