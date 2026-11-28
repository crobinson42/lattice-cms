---
'@latticecms/core': minor
---

`transaction(async (repos) => …)` runs repo writes as one store transaction. It is on `build()` and in the methods and overrides factories' wiring, beside `repos`. The work receives repos bound to the transaction, and `transaction` resolves to what it returns. `Transaction<R>` is exported, so a use case's dependency names only the repos it uses. Repos publish no events: publish after the transaction resolves.
