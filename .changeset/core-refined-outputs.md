---
'@latticecms/core': patch
---

A collection whose schema has an object-level `.refine()` now builds with refs and maskable fields. Its output schemas are built from the schema's fields, so they no longer carry the refinement, which Zod 4 refused to extend for populated reads and masked fields. The refine still checks create, and the merged document of an update.
