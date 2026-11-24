# CLI

`@latticecms/cli` gives the app the `lattice` command. It edits the app's own files where their shape gives one place for each edit, or writes nothing, exits 1, and prints the lines to add by hand.

```bash
npm install --save-dev @latticecms/cli
npx lattice --help
```

Its paths come from the `"lattice"` key in the app's `package.json`, and default to the crm's layout. `tenant` has no default. The crm sets `"lattice": { "tenant": "organizationId" }`.

## lattice collection

```bash
npx lattice collection deal_notes
```

- It writes the collection (a required `name`, its title field), a test, its `.collection()` registration in the composition, and its three events in the catalog. The test checks the registration and the schema, and builds nothing, so later refs, methods and overrides never break it.
- It needs the app's own `typescript`, 5.8 to 6. TypeScript 7 has no JavaScript API, and the CLI says to install `typescript@^6`.
- The registration's access is open to any signed-in caller, inside tenancy. Tighten it next. Read [access.md](access.md).
- `--tenant <field>` or `--global` overrides the config. `--label person,people` declares an irregular label. `--dry-run` prints a diff.
- It refuses a slug in use, a reserved name, a join collection's name, a name the files already declare, or a composition without exactly one exported `framework()` chain.

## lattice migration

```bash
npx lattice migration add-notes-index
```

- It writes the next numbered migration, whose id comes from the list's ids, and appends it to the list in `src/infra/migrations/index.ts`.
- Its `up()` throws until it is written. Write it, then build. A migration that ran is recorded, and never runs again.
- `up({ db, session, signal, logger })` gets the raw database. Documents there have their stored shape, old fields included. That is why a migration does not use a repo.
- `--transaction` runs `up` and its record in one transaction, on a replica set.

```ts
// examples/crm/src/infra/migrations/0001-backfill-deal-archived.ts
export default {
  id: 1,
  name: 'backfill-deal-archived',
  async up({ db, logger }) {
    const { modifiedCount } = await db
      .collection('deals')
      .updateMany(
        { archived: { $exists: false } },
        { $set: { archived: false } },
      );
    logger.info('deals backfilled', { modifiedCount });
  },
} satisfies Migration;
```

`up` must be safe to run again after it failed partway: the next run retries it. The filter above skips the deals already done.

## lattice migrate

```bash
npm run build && npx lattice migrate
```

It imports the built module `"lattice.migrate"` names, starts its store, runs store-mongo's `migrate()`, and stops the store. The crm's module:

```ts
// examples/crm/src/servers/scripts/migrate.ts
export const store = mongoStore(process.env);
export { migrations };
```

The crm also migrates at startup. Ordering, history and the lock are `migrate()`'s.

## When to edit by hand

- When the command refuses a shape and prints the lines, add them where it says.
- When a file is not in the crm's layout and the config cannot name it.
- Access, fields, methods, overrides and relations: the CLI scaffolds a collection, nothing more.

## Do not

- Do not number a migration by hand past a gap. `migrate()` refuses a gap or a duplicate id.
- Do not rename or remove a migration that ran. `migrate()` refuses the list.
- Do not leave a scaffolded collection's access open when the story needs less.

## Errors you will see

- Exit 1 with `lattice: <why>` and nothing written: a refusal. When the shape was the reason, the lines to add follow on stdout.
- Exit 2: a usage error or a bad `"lattice"` config, naming the key.
- `Migration 2 add-notes-index is not written yet: write up() before running it.`, from a stub that was built and run.
- `Migration ids must run 1, 2, 3 … in list order, with no gap`, from `migrate()`.
