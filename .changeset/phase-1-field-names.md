---
'@latticecms/core': minor
---

A schema field name may not contain `.`, start with `$`, or be `_id`, and neither may the tenant field. MongoDB reads them as a path, an operator or the id. It is a compile error and a throw in `collection()`. The store conformance suite gains a case: a `where` on `id` never widens a single-row call to another row.
