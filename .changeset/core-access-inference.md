---
'@latticecms/core': patch
---

`.collection()` accepts an access function that is an app's generic helper's call, such as `allow<W>(...)`, beside `methods`. Before, it reported each method as having no access function, and a plain arrow beside it lost its `actor` type. The README narrows a populated ref on a system field, `'createdAt' in post.authorId`, which works for every collection.
