# @latticecms/cli

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
