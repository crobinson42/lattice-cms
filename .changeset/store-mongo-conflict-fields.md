---
'@latticecms/store-mongo': minor
---

Peers on `@latticecms/core` 0.6. `CONFLICT` names the clashing index's fields in `data.fields`, read from the duplicate key error's `keyPattern`, with `_id` as `id`. A server that leaves `keyPattern` out gives `fields: []`.
