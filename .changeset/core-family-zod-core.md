---
'@latticecms/core': minor
---

A family use case's `input` and `output` statics accept any Zod schema (`z.core.$ZodType`), not only a classic one. A method's schemas are still classic Zod: `.collection()` checks them as before.
