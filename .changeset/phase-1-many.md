---
'@latticecms/core': minor
---

`many(target, { through, fields?, onDelete? })` on `collection(slug, { relations })` derives a join collection with `<parent>Id`, `<target>Id` and the link fields, the parent's tenant field, its own events, and a unique pair index. Every relation gets `<slug>.<relation>.list` and `.set` procedures and use cases: list pages the links under the parent's read access, and set replaces them by diff in one store transaction under the parent's update access, with an event per change after the commit. Both can be overridden by name. Deleting the parent cascades its links; deleting a target restricts or cascades. Method names may not contain a dot.
