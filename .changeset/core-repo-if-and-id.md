---
'@latticecms/core': minor
---

Repo writes take a condition, and an insert takes an id.

- `repo.update(id, patch, scope, { if })` and `repo.remove(id, scope, { if })` write only when the row meets the `if` `Where`. The store checks it in the same call as the write, so a check and its write cannot race. A row that fails it is left alone, and the call returns null, as a missing row does.
- `repo.insert(data, scope, { id })` stores the row under the given id, such as a projection that shares its source's id. An existing id is `CONFLICT`.
- **Breaking:** a repo checks each `Where` it takes, in `find`, `count` and `if`, at runtime, as an access answer is checked. An undefined operand, a field key or `and`/`or` that is present but `undefined`, or a field with no operator now throws an `Error` that names the path. Before, the clause was dropped, which widened the query. To migrate, leave the key out instead of setting it to `undefined`:

  ```ts
  // before: throws now when status is undefined
  repo.find({ where: { status: status ? { eq: status } : undefined } }, scope);
  // after
  repo.find({ where: status ? { status: { eq: status } } : {} }, scope);
  ```
