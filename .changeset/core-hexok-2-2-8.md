---
'@latticecms/core': patch
---

Requires hexok 2.2.8 as a peer, which fixes `family()`'s statics check: a collection's first hand-written use case no longer costs an app about 38k type instantiations.
