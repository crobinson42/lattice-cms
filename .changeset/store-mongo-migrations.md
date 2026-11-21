---
'@latticecms/store-mongo': minor
---

Migrations: `migrate(store, migrations, { logger, lock? })` runs an explicit list of forward-only data migrations once each, in id order, and records them in `_migrations`. The list is checked against what ran before anything runs. A migration may opt into a transaction. A lease lock in `_migrations_lock` keeps two processes from migrating at once; a second one waits. `@hexok/logger` is now a peer dependency.
