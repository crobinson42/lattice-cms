---
'@latticecms/core': minor
---

`CONFLICT` data gains `fields`: the clashing unique index's fields as declared, tenant field included, `['id']` when the id exists, or `[]` when the store cannot tell. An app tells the user which value is taken without another query. The message is now "A document with the same unique key already exists".

`MemoryStore` matches MongoDB more closely:

- An index over an array keys each element, so two documents that share one element clash on a unique index, and two empty arrays clash. An index refuses a document with two array fields, as MongoDB does.
- `work` receives a store of its own, as MongoDB binds calls to a session. A `transaction` on that store joins the outer one. A call on the root store from inside `work` does not join, and a rollback keeps it.
- Transactions run one at a time. One that started while another ran used to join it, so the first one's rollback dropped the second's writes. A rollback now undoes only the transaction's own writes and indexes.
- `remove` returns a copy, as every other call does, so changing it cannot change what a rollback restores.
- A `CONFLICT` inside a transaction aborts it, as on MongoDB. A later call in it, or the commit, throws with an explanation. On MongoDB, catching the `CONFLICT` and carrying on makes the driver retry `work` until it times out. The core README shows how to run the transaction again.

**Breaking**:

- A custom `CollectionStore` must pass `fields` when it throws `CONFLICT`: `LatticeError.CONFLICT({ collection, id, fields: ['id'] })`.
- A test that matches `CONFLICT`'s data or message exactly must expect the new shape.
- On `MemoryStore`, code that catches a `CONFLICT` inside a transaction and carries on now throws. Run the transaction again instead, as the core README shows.
- On `MemoryStore`, a write that shares one array element with another row, or has two array fields in one index, now rejects. Fix the data or the index, as MongoDB would require.
- On `MemoryStore`, `work` that awaits a transaction started after it, outside its own async context, now waits forever. Do the work on the store `work` receives.
- On `MemoryStore`, a call on the root store inside `work` no longer joins the transaction, and a call on `work`'s store after the transaction ends throws. Use the store `work` receives, only while `work` runs.
