---
'@latticecms/store-mongo': minor
---

`find` sorts optional fields with missing values last, in either direction. A sort with no ascending optional key is a plain, index-served sort. When the first key is the one ascending optional key, it runs two queries: documents with a value, which an index on the field serves, then documents without one, only when the page is not full. Any other ascending optional key sorts through an aggregate with a computed key. Needs `@latticecms/core` with `FindQuery.optional`.
