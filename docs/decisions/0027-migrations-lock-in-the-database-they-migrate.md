---
status: proposed
strength: default
date: 2026-11-21
revisit: hexok ships a general Lock port, or migrations must coordinate across more than one database.
---

# 0027. Migrations run forward only, from an explicit list, under a lease lock in their own database

## Decision

`migrate(store, migrations, { logger, lock? })` in `@latticecms/store-mongo` runs each pending migration once, in id order.

- **A migration is `{ id, name, transaction?, up }`.** `up` receives `{ db, session?, signal, logger }`, where `db` is the raw Mongo `Db`. Migrations run forward only.
- **The app passes an explicit list.** Before anything runs, the runner checks it against `_migrations`. A gap, a duplicate, a recorded id missing from the list, or a recorded id with a new name is a `MigrationError`. There is no checksum.
- **A migration is recorded after `up` resolves.** A throw stops the run, and the next run retries that migration, so `up` must be safe to re-run.
- **A transaction is opt-in per migration (`transaction: true`).** The migration and its record then commit together.
- **The lock is a lease document in `_migrations_lock`.**
  - It is taken atomically with the server's clock, renewed every third of its TTL, and released by token.
  - `signal` aborts if the lock is lost.
  - A second process waits, up to `waitMs`, and then rejects with `LockTimeout`.
  - The lock sits behind an internal seam.

## Why

`@hexok/schedule-coordinator-redis` is a cron port. `register()` returns nothing, and a process that misses the lock skips silently. So a runner could not tell whether migrations ran, and a second process could serve traffic on a database still being migrated. A lease in the database being migrated adds no dependency and no Redis. It locks the one system migrations touch.

A typed repo is typed by the current schema, so it cannot read a document's old shape, and it has no bulk updates. Hence the raw `Db`. A directory glob breaks under bundlers, so the list is explicit. Checksums of transpiled functions raise false alarms. Long migrations exceed transaction limits, so transactions are opt-in.

## Rejected

- **schedule-coordinator-redis, as Phase 1's plan first said:** a fake cron, and no way to know whether the run happened or was skipped.
- **Waiting for a hexok `Lock` port:** reusable, but step 7 would wait on hexok's scope gate. The internal seam lets one replace the lease later.
- **Down migrations:** rarely run until the day they matter, when they lose data. A bad migration is fixed by a new one that moves forward.
- **Skipping when another process holds the lock:** the process would serve a database mid-migration.
