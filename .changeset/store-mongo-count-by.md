---
'@latticecms/store-mongo': minor
---

`MongoStore` implements `countBy` as one aggregation: `$match`, `$project` and `$unwind` to each value's keys, then `$group`, `$sort` and `$limit`.
