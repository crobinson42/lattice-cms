---
'@latticecms/core': minor
---

Tracing through `@opentelemetry/api`, now a peer dependency (`^1.3.0`): install it beside core. Each procedure is a server span named by its path, such as `deals/find`, from Lattice's router middleware, so every caller gets it. Each use case is an internal span from the family's hooks, with its token, collection, action, actor id, tenant or bypass, and outcome. A refusal leaves the status unset, with `lattice.outcome: 'refused'` and `lattice.code`; an unexpected throw sets ERROR with an exception event. No span carries input, a document or a masked value. With no SDK registered the API is a no-op.
