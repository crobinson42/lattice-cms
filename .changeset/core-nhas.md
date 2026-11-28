---
'@latticecms/core': minor
---

`Where` gains `nhas` on arrays of strings, numbers or enum values: it matches an array with no element equal to its value. A missing or null array has none, so `nhas` matches it; add `exists: true` to require the array. It lets an access function refuse by membership, such as `{ blockedOrgIds: { nhas: actor.orgId } }`, inside the query.

For store adapters: `FieldOps` has `nhas`, and the conformance suite has cases for it.

`has` and `nhas` refuse a null operand with `VALIDATION`, even when the array's element schema allows null. Mongo matches a missing array with `has: null`, the reverse of "a missing array has no elements".
