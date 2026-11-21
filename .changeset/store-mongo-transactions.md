---
'@latticecms/store-mongo': minor
---

`MongoStore.transaction(work)` runs `work` in one Mongo transaction on a replica set, with a session-bound view of the store, and in order on a standalone server. `has` translates to equality on the array field.
