# @latticecms/cli

The `lattice` command. It adds a collection to a Lattice app: the collection, a test, its registration in the app's composition, and its events in the app's events catalog. It edits the app's files where their shape gives one place for each edit, or writes nothing and prints the lines to add by hand.

Status: unpublished, before 1.0.

## Install

```bash
npm install --save-dev @latticecms/cli
```

`@latticecms/core` and `typescript` are peer dependencies; the app has both. The CLI parses the app's files with the app's own `typescript`, resolved from the app's directory, and refuses one older than 5.8. `@latticecms/store-mongo` is an optional peer, for the migration commands to come.

Run it from anywhere inside the app, with `npx lattice`. `lattice --help` lists the commands.

## Config

The CLI reads the `"lattice"` key of the nearest `package.json` at or above the current directory. Every key is optional. Paths are relative to that `package.json`, and default to the layout of [`examples/crm`](../../examples/crm):

```json
{
  "lattice": {
    "collections": "src/domain/collections",
    "composition": "src/servers/rpc/contract.ts",
    "events": "src/domain/events/domain-events.ts",
    "family": "src/app/use-cases/context.ts#AppUseCase",
    "tenant": "organizationId"
  }
}
```

| Key | What it names | Default |
| --- | --- | --- |
| `collections` | The directory of collection files | `src/domain/collections` |
| `composition` | The file with the app's one `framework()` chain | `src/servers/rpc/contract.ts` |
| `events` | The file with the app's one `EventCatalog()` | `src/domain/events/domain-events.ts` |
| `family` | The family's file and export, joined by `#` | `src/app/use-cases/context.ts#AppUseCase` |
| `tenant` | The tenant field of a new collection | none |

`tenant` has no default: a guessed field name would tenant a collection by a field the app does not use. Without it, `lattice collection` needs `--tenant` or `--global`.

A bad config is a usage error that names the file and the key: invalid JSON, an unknown key, a value that is not a non-empty string, a reserved or invalid tenant field, a path that is absolute or leaves the app, or a path that is missing or is a file where a directory belongs, or the reverse.

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
- The test builds a one-collection framework with the app's family over `MemoryStore`, and stores and reads a document. It also checks that the composition's contract has the slug.
- Each edit is inserted as text; the file is never reprinted. Imports go in Biome's order. Inserted lines use the file's line breaks (LF or CRLF) and its indent unit (a tab or its spaces), and go after any comment that ends the line before them.
- Generated lines break where Biome breaks them at its default width of 80, one level deep. A name long enough to need a second level is left to the app's formatter.
- `--dry-run` prints each change as a unified diff and writes nothing.

Every edit is computed before any file is written. The new texts are staged in files beside their targets. Each edited file must still hold the text that was parsed, and be writable, before any staged file takes its target's place. If a write fails, the staged files are removed and any file already placed is restored, so a failed run changes nothing.

The command refuses, writes nothing and exits 1 when:

- the slug is not lower snake case, or is one of core's `reservedNames`;
- the collection's file or test exists, or a file in the collections directory (`.ts`, `.tsx`, `.mts` or `.cts`, but tests and declarations) has the slug in core's `collection()`, by any name it imports it as, or in a relation's `through`;
- the composition or the catalog already imports or declares the export's name at the top level, or already registers it or lists its events;
- the export's name is one the generated test imports: `framework`, `MemoryStore`, `tenancy` or `unscoped`, `describe`, `expect`, `it`, the family, or the composition's export;
- the field `--tenant` names is one of core's `reservedFields`, or is not a field name;
- the composition has no `framework()` chain, or more than one, or its chain is not an `export const` of `.collection()` calls; or the events file has no `EventCatalog()` with an object literal, or more than one.

For the last two, it also prints every change it would have made, and where each line goes, so the edit can be made by hand. Running the command again after it succeeded is refused: the collection's file exists.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Done, or a dry run |
| 1 | Refused or failed. One line on stderr, `lattice: <why>`. Nothing was written |
| 2 | A usage error: an unknown command or flag, a missing slug, or a bad config. The command's usage line follows |
