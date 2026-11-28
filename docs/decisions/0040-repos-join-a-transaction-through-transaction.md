---
status: proposed
strength: default
date: 2026-11-27
revisit: A collection lives in a different store from another that one transaction writes, the outbox replaces held events, or apps compose use cases that each open a transaction.
---

# 0040. Repos join a transaction through `transaction`, beside `repos`

## Decision

- `build()` returns `transaction`, and both factories receive it beside `repos`: `transaction(async (repos) => …)`. It runs `CollectionStore.transaction` and hands `work` a repo per collection bound to the transaction's store. It resolves to what `work` returns.
- `work` receives repos. In the overrides factory, it also receives `generated`: the overridden generated operations, bound to the transaction's store. Their events are held per attempt and published after the commit, as a generated delete's are ([0028](0028-relations-delete-in-a-store-transaction-as-system-work.md)). Generated use cases with their guards, and every other publish, stay outside: the app publishes its own events after the transaction resolves.
- Its type is `Transaction<R, G>`, exported. A use case's dependency names only the repos and generated operations it uses, `Transaction<{ deals: Repo<typeof Deals> }>`, and the one over every repo fits it. `G` defaults to none, which is what `build()` and the methods factory give.
- On a store with no rollback, such as a standalone MongoDB, a throw in `work` keeps the generated writes made before it and drops their events, as a generated delete's cascade does.
- The store decides how atomic it is, as [0028](0028-relations-delete-in-a-store-transaction-as-system-work.md) set. `work` may run more than once on MongoDB, so it holds no side effects.
- `transaction` does not nest. Each call starts its own store transaction. Code that runs inside one takes the repos `work` received, as arguments.

## Why

StaffDuty and DutyHire each write two rows that must agree: a record and its projection, a booking and a slot. StaffDuty's ticket update override writes audit rows beside the generated update, and record [0036](0036-an-override-can-call-the-generated-operation.md) has an override add a rule and then run the generated operation, so that operation must be able to join. The store port already had `transaction`, but an app could only reach the `CollectionStore`, which is untyped and skips scopes. Repos bound to the transaction keep the typed, scoped API apps already use. The factories are where apps already get their repos, so the wiring gains one key and no new concept.

## Rejected

- **`repo.withTransaction(tx)` on each repo.** Each call site rebinds each repo, and a missed one silently writes outside the transaction.
- **A transaction in the call context, picked up by every repo.** Implicit: which writes join depends on where code runs, and repos would need the context they deliberately lack.
- **Generated operations that publish as they write, inside the transaction.** A rollback cannot take an event back, and a MongoDB retry would publish twice. Holding the events until the commit removes both, with the same guarantee a generated write has outside a transaction.
- **`generated.x.op(ctx, input, { repos })`.** Each call site rebinds, as `withTransaction` would.
- **Handing apps the raw `CollectionStore`.** Untyped, and it skips the scope rules repos enforce.
- **A nested `transaction` that joins the outer one.** The `transaction` a use case holds is bound when the app is wired, so it cannot see an outer one without an implicit async context. That is the same implicitness as a transaction in the call context. Passing repos keeps it explicit.
