# @latticecms/cli

The `lattice` command. It adds a collection to a Lattice app: the collection, a test, its registration in the app's composition, and its events in the app's events catalog. It adds a data migration to the app's list, and runs the pending ones as a deploy step. It edits the app's files where their shape gives one place for each edit, or writes nothing and prints the lines to add by hand.

Status: before 1.0, not yet published. The root README's [Getting started](../../README.md#3-collections) uses it on an empty app.

## Install

```bash
npm install --save-dev @latticecms/cli
```

`@latticecms/core` and `typescript` are peer dependencies; the app has both. The CLI parses the app's files with the app's own `typescript`, resolved from the app's directory: 5.8 to 6. TypeScript 7 is the native compiler and has no JavaScript API, so the CLI refuses it, and says to install `typescript@^6`. `@latticecms/store-mongo` and `@hexok/logger` are optional peers: `lattice migrate` imports them from the app, and the other commands run without them.

Run it from anywhere inside the app, with `npx lattice`. `lattice --help` lists the commands.

## Config

The CLI reads the `"lattice"` key of the nearest `package.json` at or above the current directory. Every key is optional. Paths are relative to that `package.json`, and default to the layout of [`examples/crm`](../../examples/crm):

```json
{
  "lattice": {
    "collections": "src/domain/collections",
    "composition": "src/servers/rpc/contract.ts",
    "events": "src/domain/events/domain-events.ts",
    "migrations": "src/infra/migrations",
    "migrate": "dist/servers/scripts/migrate.js",
    "tenant": "organizationId"
  }
}
```

| Key | What it names | Default |
| --- | --- | --- |
| `collections` | The directory of collection files | `src/domain/collections` |
| `composition` | The file with the app's one `framework()` chain | `src/servers/rpc/contract.ts` |
| `events` | The file with the app's one `EventCatalog()` | `src/domain/events/domain-events.ts` |
| `migrations` | The directory of migrations, with the list in its `index.ts` | `src/infra/migrations` |
| `migrate` | The built module `lattice migrate` imports | `dist/servers/scripts/migrate.js` |
| `tenant` | The tenant field of a new collection | none |

`tenant` has no default: a guessed field name would tenant a collection by a field the app does not use. Without it, `lattice collection` needs `--tenant` or `--global`.

A bad config is a usage error that names the file and the key: invalid JSON, an unknown key, a value that is not a non-empty string, a reserved or invalid tenant field, a path that is absolute or leaves the app, or a path a command needs that is missing or is a file where a directory belongs, or the reverse. `migrate` names built output, so it may be missing until the app is built.

## `lattice collection`

```bash
lattice collection <slug> [--tenant <field> | --global] [--label <singular>,<plural>] [--dry-run]
```

```bash
$ npx lattice collection deal_notes
created src/domain/collections/deal-notes.ts
created src/domain/collections/deal-notes.test.ts
edited src/servers/rpc/contract.ts
edited src/domain/events/domain-events.ts
deal_notes is open to any signed-in caller. Tighten its access in src/servers/rpc/contract.ts.
```

- The slug is lower snake case and plural, such as `deal_notes`. The file is `deal-notes.ts`, the export `DealNotes`, and the events `dealNotesCreated`, `dealNotesUpdated` and `dealNotesDeleted`.
- The collection has one field, `name`, a title for lists and pickers. Edit its schema next.
- `--tenant <field>` tenants it by that field, over `"lattice.tenant"`. `--global` makes it global.
- `--label person,people` declares its label, for a slug whose singular core would get wrong. Without it, core's `labelOf(slug)` gives the label.
- The composition gets an import and `.collection(DealNotes, { access })` at the end of its chain, open to any signed-in caller, inside tenancy. It uses the file's `anyone` when it declares one, else `() => true`. Tighten it.
- The events catalog gets an import and the three events after the last collection's. The app's publisher takes only the catalog's events, so without them the app does not compile.
- The test checks what the scaffold made, and builds nothing: the composition's contract has the slug and its six operations (which also proves every ref resolves within the app), and the schema parses `{ name: 'First' }` and refuses `{}` at `name`. A ref, a relation, a method or an override anywhere in the app never breaks it. Test behavior through the app's own test setup.
- Each edit is inserted as text; the file is never reprinted. Imports go in Biome's order. Inserted lines use the file's line breaks (LF or CRLF) and its indent unit (a tab or its spaces), and go after any comment that ends the line before them.
- Generated lines break where Biome breaks them at its default width of 80, one level deep. A name long enough to need a second level is left to the app's formatter.
- `--dry-run` prints each change as a unified diff and writes nothing.

Every edit is computed before any file is written. The new texts are staged in files beside their targets. Each edited file must still hold the text that was parsed, and be writable, before any staged file takes its target's place. If a write fails, the staged files are removed and any file already placed is restored, so a failed run changes nothing.

The command refuses, writes nothing and exits 1 when:

- the slug is not lower snake case, or is one of core's `reservedNames`;
- the collection's file or test exists, or a file in the collections directory (`.ts`, `.tsx`, `.mts` or `.cts`, but tests and declarations) has the slug in core's `collection()`, by any name it imports it as, or in a relation's `through`;
- the composition or the catalog already imports or declares the export's name at the top level, or already registers it or lists its events;
- the field `--tenant` names is one of core's `reservedFields`, or is not a field name;
- the composition has no `framework()` chain, or more than one, or its chain is not an `export const` of `.collection()` calls; or the events file has no `EventCatalog()` with an object literal, or more than one.

For the last two, it also prints every change it would have made, and where each line goes, so the edit can be made by hand. Running the command again after it succeeded is refused: the collection's file exists.

## `lattice migration`

```bash
lattice migration <name> [--transaction] [--dry-run]
```

```bash
$ npx lattice migration add-notes-index
created src/infra/migrations/0002-add-notes-index.ts
edited src/infra/migrations/index.ts
```

- The name is kebab case. The file is `<id>-<name>.ts`, its id four digits, and its default export is a `Migration` for store-mongo's `migrate()`. Its comment says what `up({ db, session, signal, logger })` receives. Its `up` throws `Migration 2 add-notes-index is not written yet` until it is written, so a build that runs it early, or a server that migrates at startup, fails instead of recording an empty migration as done.
- The next id is one past the list's: the CLI reads each listed migration's `id` from its file's default export, not from file names.
- `index.ts` gets a default import, `m0002`, and the name at the end of its one exported array. A list on one line stays there while it fits in 80 columns, and is broken one per line when it does not. A list on several lines gets a line of its own. Comments, line breaks and indent are kept, as in `lattice collection`.
- `--transaction` writes `transaction: true`: `up` and its record commit together, which needs a replica set.
- `--dry-run` prints a diff and writes nothing. Writes are staged and placed as `lattice collection`'s are: all or none.

It refuses, writes nothing and exits 1 when the list has a gap or a duplicate id, which `migrate()` would refuse too (its error is named); when a listed migration's file has no numeric `id` and string `name`; when a migration of that name is listed or its file exists; or when `index.ts` has no exported array, or more than one. A name that is not kebab case is a usage error.

## `lattice migrate`

```bash
lattice migrate
```

Runs the app's pending migrations, as a deploy step for an app that does not migrate at startup, or before it starts. Build the app first: the command imports the module `"lattice.migrate"` names, which exports `store`, a `MongoStore` that is not started, and `migrations`, the list. The crm's:

```ts
// examples/crm/src/servers/scripts/migrate.ts
import { migrations } from '../../infra/migrations/index.js';
import { mongoStore } from '../../infra/store.js';

/**
 * What `npx lattice migrate` runs, after `npm run build`: the store, not
 * started, and the migrations. The server also migrates at startup.
 */
export const store = mongoStore(process.env);
export { migrations };
```

The module reads its connection settings as the app's server does; the CLI never sees them. The command starts the store, runs `migrate(store, migrations, { logger })` with a `ConsoleLogger`, and stops the store. Ordering, history and the lock are `migrate()`'s; see [store-mongo's README](../store-mongo#migrations). The output is `migrate()`'s log, and the command adds no lines of its own: one line per migration that ran, with its duration, or `migrations up to date`, and a line while it waits for another process's lock:

```bash
$ npm run build && npx lattice migrate
2026-11-23T10:00:00.000Z info migration {"id":2,"name":"add-notes-index","durationMs":41,"outcome":"ok"}
```

It exits 1 with one line when `@latticecms/store-mongo` or `@hexok/logger` is not installed in the app (with the command to install it), when the module is missing or does not load, when it lacks `store` or `migrations`, on a `MigrationError` (its message and data), or when the store cannot connect.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done, or a dry run |
| 1 | Refused or failed. One line on stderr, `lattice: <why>`. Nothing was written |
| 2 | A usage error: an unknown command or flag, a missing or bad slug or name, or a bad config. The command's usage line follows |
