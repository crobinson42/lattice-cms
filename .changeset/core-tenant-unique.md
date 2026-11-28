---
'@latticecms/core': minor
---

**Breaking.** On a tenanted collection, a unique index must include the tenant field. Leaving it out is now a compile error and a throw in `collection()`, because such an index clashes across tenants, and its `CONFLICT` tells one tenant what another holds. To migrate, add the tenant field to the index, such as `{ organizationId: 1, email: 1 }`. Then write a migration that drops the old index, and run it before `ensure()`. Non-unique indexes are unchanged.

A client's `CONFLICT` now leaves out the collection's tenant field, which the client cannot change, unless it is the index's only field. Server code that catches the `LatticeError` still gets every field.

`build()` returns `clientError(error)`: the ts-pf error the procedures send for a `LatticeError`, or undefined for any other. An app's own router, such as sign-in, throws it from a middleware, so it answers as `/rpc` does. Core exports `latticeErrors`, the declared errors with their statuses, for that router's `.errors()`.

MemoryStore's `ensure()` error for an index with other options now says to drop the old index in a migration.
