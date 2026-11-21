---
'@latticecms/core': minor
---

Tenancy: `collection(slug, { tenant })` and `family({ tenantOf })`. Create stamps the tenant field, every scope filters by it, update never writes it, and clients cannot set it. `tenantOf` may return `tenancy.bypass` for a platform actor, which reads across tenants, cannot write tenanted collections, and is logged. Server code scopes by tenant with `tenancy.scope(C, tenantId)`; `unscoped` cannot insert into a tenanted collection. Events of tenanted collections carry `tenantId`, and so do log lines and `Scope`. New export: `tenancy`.
