# @latticecms/cli

## 0.3.0

### Minor Changes

- [#10](https://github.com/crobinson42/lattice-cms/pull/10) [`fc7e0e3`](https://github.com/crobinson42/lattice-cms/commit/fc7e0e3a63ad23e092496e93312ab5f5e9600654) Thanks [@crobinson42](https://github.com/crobinson42)! - Peers on `@latticecms/core` 0.5. Upgrade core, store-mongo and the CLI together.

### Patch Changes

- Updated dependencies [[`fc7e0e3`](https://github.com/crobinson42/lattice-cms/commit/fc7e0e3a63ad23e092496e93312ab5f5e9600654), [`fc7e0e3`](https://github.com/crobinson42/lattice-cms/commit/fc7e0e3a63ad23e092496e93312ab5f5e9600654)]:
  - @latticecms/core@0.5.0
  - @latticecms/store-mongo@0.5.0

## 0.2.0

### Minor Changes

- [#8](https://github.com/crobinson42/lattice-cms/pull/8) [`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f) Thanks [@crobinson42](https://github.com/crobinson42)! - Peers on `@latticecms/core` 0.4. Upgrade core, store-mongo and the CLI together.

### Patch Changes

- Updated dependencies [[`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f), [`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f), [`ceaf8a6`](https://github.com/crobinson42/lattice-cms/commit/ceaf8a6bb9f3fe2056d02e217e3c4c9a6c4d018f)]:
  - @latticecms/core@0.4.0
  - @latticecms/store-mongo@0.4.0

## 0.1.2

### Patch Changes

- Updated dependencies [[`66d2468`](https://github.com/crobinson42/lattice-cms/commit/66d246810820613c55450be4e8ff5129265b69af), [`66d2468`](https://github.com/crobinson42/lattice-cms/commit/66d246810820613c55450be4e8ff5129265b69af)]:
  - @latticecms/core@0.3.0
  - @latticecms/store-mongo@0.3.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`94d5203`](https://github.com/crobinson42/lattice-cms/commit/94d5203d35bb7109b415da436c6b7c48cb930509), [`74c37fe`](https://github.com/crobinson42/lattice-cms/commit/74c37fe5e237f0918de593cb358b7b4da0861a3d), [`03059f7`](https://github.com/crobinson42/lattice-cms/commit/03059f79c707c3e71ba2f507d38f6c2611cf797e), [`e3fb0eb`](https://github.com/crobinson42/lattice-cms/commit/e3fb0ebe5e4bdb5268306b0e3f50f105977fbc90), [`1fb7e25`](https://github.com/crobinson42/lattice-cms/commit/1fb7e2508b8ab2832e92759a0da64ec96845b828), [`74c37fe`](https://github.com/crobinson42/lattice-cms/commit/74c37fe5e237f0918de593cb358b7b4da0861a3d)]:
  - @latticecms/core@0.2.0
  - @latticecms/store-mongo@0.2.0

## 0.1.0

### Minor Changes

- [`edc0e97`](https://github.com/crobinson42/lattice-cms/commit/edc0e97f457d94d362efbf0b320be4faf6f3dc19) Thanks [@crobinson42](https://github.com/crobinson42)! - First release. The `lattice` command, for an app on `@latticecms/core`.

  - `lattice collection <slug>` writes a collection and its test, registers the collection in the app's `framework()` chain, and lists its events in the app's `EventCatalog()`. `--tenant`, `--global` and `--label` shape it.
  - `lattice migration <name>` writes the next numbered migration, whose `up()` throws until it is written, and appends it to the app's list.
  - `lattice migrate` imports the app's built `{ store, migrations }` module and runs `@latticecms/store-mongo`'s `migrate()`, as a deploy step.
  - It parses the app's files with the app's own `typescript` and inserts text where a file's shape gives one place for it, keeping its comments, line breaks and indent. On any other shape it writes nothing, exits 1 and prints the lines to add by hand. It writes every file or none, and `--dry-run` prints a diff.
  - Paths come from an optional `"lattice"` key in `package.json`, which defaults to the crm's layout. `tenant` has no default.

  Install it with its peers: `npm install --save-dev @latticecms/cli`, beside `@latticecms/core` and `typescript` 5.8 to 6. TypeScript 7, the native compiler, has no JavaScript API for the CLI to parse with. See the [README](./README.md#install).

### Patch Changes

- Updated dependencies [[`355f2b5`](https://github.com/crobinson42/lattice-cms/commit/355f2b5d9ec18ccd637d861abc5639ea036e7ae2), [`355f2b5`](https://github.com/crobinson42/lattice-cms/commit/355f2b5d9ec18ccd637d861abc5639ea036e7ae2)]:
  - @latticecms/core@0.1.0
  - @latticecms/store-mongo@0.1.0
