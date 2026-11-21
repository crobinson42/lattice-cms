---
status: proposed
strength: default
date: 2026-11-21
revisit: Support staff need to write across tenants, or an app needs a bypass decided by something the actor cannot carry.
---

# 0024. The family's `tenantOf` decides a tenant bypass, and server code scopes by tenant explicitly

## Decision

- **A call's tenant comes from the family.** `family({ tenantOf })` returns the actor's tenant id, or `tenancy.bypass` for a platform actor, such as `(a) => a.support ? tenancy.bypass : a.organizationId`. The actor schema validates the flag. The edge sets it per request.
- **A bypass reads only.** A bypassed call has no tenant clause and is read-only on tenanted collections: generated create, update and delete are `FORBIDDEN`, and so are a repo's writes. The call's log line carries `tenancy: 'bypass'`, and each bypassed scope is logged with the actor, collection and action.
- **Every scope carries the tenant clause.** `ctx.access.scope()` ANDs the tenant clause with the access `Where`. The clause is not part of the access answer, so create is stamped too. The tenant field is in the output, `Doc` and `Where`, never in create or update input, and update never writes it.
- **Server code says which tenant it works in.** An event handler uses `tenancy.scope(C, tenantId)`, which adds the tenant clause and no access, and stamps the tenant on insert. `unscoped` still reads and writes across tenants, but it cannot insert into a tenanted collection. That is a compile error and a runtime throw.
- **A tenanted collection needs a family with `tenantOf`.** Without one, `.collection()` is a compile error and a runtime throw.

## Why

[0009](0009-strict-tenant-isolation-in-v1.md) logs every bypass. When the family decides, the decision is made once, on every path: RPC, local and `build().context()`. Otherwise every context builder repeats it. Read-only is the narrow start: support can look, and a mistaken write cannot touch another organization. A row without a tenant would be invisible to every tenant, so no path may insert one.

## Rejected

- A per-context `tenancy.bypass(actor)` set by the edge: every context builder repeats the decision, and the argument repeats an actor the family already has.
- A read-write bypass: widen it when a real support case needs it.
- Banning `unscoped` on tenanted collections in favor of a `tenancy.all`: one more name for the same explicit opt-out.
- `unscoped('reason')`: a string at every call, and a repo has no logger to log it with.
