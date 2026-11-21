---
'@latticecms/core': patch
---

The actor every hook sees is the one the family's schema parsed: access functions, `tenantOf`, `actorId`, log lines, `execute`'s `ctx.actor` and events. Before, they saw the caller's object as given, so a key the schema strips, such as an unexpected `support` flag, still reached them, and a transform's output did not. An invalid actor is still one `UNAUTHORIZED` with the same log line.
