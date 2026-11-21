---
'@latticecms/core': minor
---

Access: `.collection(C, { access })` takes one function per action, and a family guard checks it before every use case. A refusal is `FORBIDDEN`; an access `Where` filters every store call, so a row outside it is `NOT_FOUND`. Every `Repo` call takes a required `Scope` from `ctx.access.scope()`, or `unscoped`. `build({ access })` takes another `Access` adapter, and `build().context()` makes the context for a direct `execute` call. New exports: `Access`, `AccessRequest`, `CallAccess`, `CallContext`, `Scope` and `unscoped`.
