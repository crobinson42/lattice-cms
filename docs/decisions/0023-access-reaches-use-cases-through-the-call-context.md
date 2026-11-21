---
status: accepted
strength: default
date: 2026-11-21
revisit: hexok lets a guard add to the context that `execute` receives, or a second `Access` adapter needs more than actor, collection, action and create data.
---

# 0023. Access reaches use cases through the call context, and repos take a required scope

## Decision

- **A family guard checks access on every use case.** This covers generated operations, overrides and methods. `false` throws `FORBIDDEN`, and the guard logs that refusal once.
- **`FamilyContext` carries `access`.** Lattice's procedure handler adds it on each call, as the edge adds the logger. Code that calls `execute` directly makes a context with `build().context({ actor, logger })`.
- **A use case gets its filter from the context.** It calls `ctx.access.scope(Collection, action)`, which returns a `Scope` that holds the collection slug and its filter. The answer is cached on the context, so each call checks access once. `create` is never cached, because its answer depends on `data`.
- **Every `Repo` call takes a required scope as its last argument.** Trusted code (event handlers, workers, scripts) passes `unscoped` explicitly. Step 3 decides whether `unscoped` becomes `tenancy.bypass(actor)`. A repo throws when it is given a `Scope` for another collection.
- **Filters only narrow.** An access `Where` and the caller's `where` are ANDed, and so is the tenant clause from step 3.
- **The default adapter takes its functions from `.collection()`.** `access` is required there ([0021](0021-access-attaches-at-composition.md)). `access: {}` denies everything, and a missing function denies its action. A declared method with no access function is a compile error.
- **Soft delete is a `read` filter**, for example `read: () => ({ archived: { eq: false } })`.

## Why

A hexok guard receives the call and can throw, but `execute` receives the caller's `ctx` and `input` unchanged, so a guard cannot hand it a filter. The call context already carries per-call values, such as the logger. Checking access in the guard means no use case can skip the `FORBIDDEN` check. The required scope means no method can skip the row filter, which [0005](0005-access-and-tenancy-are-query-filters.md) requires. A filter that only narrows cannot widen access.

## Rejected

- **Injecting `Access` into each method's deps:** no guard sees it, so a method that never calls it runs with no access check.
- **Wrapping each instance's `execute` at `build()`:** the wrapper runs before hexok's actor guard, and it monkeypatches instances.
- **A WeakMap from `ctx` to the scope:** concurrent calls share one context object.
- **An optional repo scope:** a forgotten filter reads every row, and nothing reports it.
- **An allow-all default, or a collection with no `access` silently denying:** the first is a footgun, and the second fails only at runtime.
- **A `softDelete` collection option:** a new option with an opt-out on every client type. Revisit it with Phase 4's versions and drafts.
