---
status: proposed
strength: default
date: 2026-11-27
revisit: A collection lives in a different store from another that one transaction writes, the outbox needs generated operations to run inside an app's transaction, or apps compose use cases that each open a transaction.
---

# 0040. Repos join a transaction through `transaction`, beside `repos`

## Decision

- `build()` returns `transaction`, and both factories receive it beside `repos`: `transaction(async (repos) => …)`. It runs `CollectionStore.transaction` and hands `work` a repo per collection bound to the transaction's store. It resolves to what `work` returns.
- Its type is `Transaction<R>`, exported. A use case's dependency names only the repos it uses, `Transaction<{ deals: Repo<typeof Deals> }>`, and the one over every repo fits it.
- Only repos are offered inside. Generated use cases, hooks and events stay outside: the work is trusted server code, as a repo is. The app publishes its events after the transaction resolves.
- The store decides how atomic it is, as [0028](0028-relations-delete-in-a-store-transaction-as-system-work.md) set. `work` may run more than once on MongoDB, so it holds no side effects.
- `transaction` does not nest. Each call starts its own store transaction. Code that runs inside one takes the repos `work` received, as arguments.

## Why

StaffDuty and DutyHire each write two rows that must agree: a record and its projection, a booking and a slot. The store port already had `transaction`, but an app could only reach the `CollectionStore`, which is untyped and skips scopes. Repos bound to the transaction keep the typed, scoped API apps already use. The factories are where apps already get their repos, so the wiring gains one key and no new concept.

## Rejected

- **`repo.withTransaction(tx)` on each repo.** Each call site rebinds each repo, and a missed one silently writes outside the transaction.
- **A transaction in the call context, picked up by every repo.** Implicit: which writes join depends on where code runs, and repos would need the context they deliberately lack.
- **Generated use cases inside the transaction.** They publish events, which a rollback cannot take back, until the outbox exists.
- **Handing apps the raw `CollectionStore`.** Untyped, and it skips the scope rules repos enforce.
- **A nested `transaction` that joins the outer one.** The `transaction` a use case holds is bound when the app is wired, so it cannot see an outer one without an implicit async context. That is the same implicitness as a transaction in the call context. Passing repos keeps it explicit.
