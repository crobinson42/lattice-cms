---
status: proposed
strength: default
date: 2026-11-25
revisit: An override needs to change a generated operation's input or output schema, or hexok lets a use case call another's body without running its wrapper again.
---

# 0036. An override can call the generated operation it replaces

Extends [0018](0018-methods-and-overrides-attach-in-the-framework.md).

## Decision

- `build()`'s overrides factory receives `generated` beside `repos`: `overrides: ({ repos, generated }) => …`. It holds only the operations the app declared as overrides. `generated.<slug>.<operation>` is a function `(ctx, input) => Promise<Doc<C>>` that runs that generated operation's body: parse, the access scope, hooks, the store write and events. It does not run the family's guards, logging or spans. The override's own use case has already run them, so they run once. The router masks the override's result, as it masks any output (0031).
- A body never relies on the guards for a check its own action needs: create's access, a withheld field in an update patch (0035), populate keys. So calling one body from another operation's override skips nothing.
- Core exports the input types an override's `execute` declares: `CreateInput<C>` and `UpdateInput<C>`, each the schema's input of that generated operation.
- An override that adds a rule checks the input or the stored document, then returns `generated.<slug>.<operation>(ctx, input)`. An override that changes what the operation does, such as an archiving delete, still writes through `repos`.

## Why

The most common reason to override update or create is to add a rule and keep everything else. Today that means copying core's update: the null that clears a field, validating the merged document, writing only the diff, and publishing `updated` with `previous`. The copy drifts whenever core changes. The crm hit this as soon as `deals.update` had to refuse a won or lost stage, which only `deals.close` may set ([0019](0019-hooks-are-before-change-and-after-read.md) puts business rules in overrides, not hooks).

An override cannot call the generated instance instead: hexok wraps `execute` on each instance, so guards, the access check and the log line would run twice.

## Rejected

- **A validating `beforeChange` hook.** It supersedes 0019, and it hides a business rule in a data hook.
- **Field write rules.** They help with a server-owned field, but a field rule sees the actor and not the value (0031), so it cannot refuse a stage.
- **`Draft<C>` and `Patch<C>` as the input names.** `@latticecms/core/store` already exports a `Patch`, where `undefined` removes a field, while the update input clears with `null`. Two opposite rules under one name invite mistakes.
- **Every body in `generated`.** A body called by another operation's override would skip that operation's guards.
- **Re-validating, diffing and publishing in `Repo.update`.** It would change what system code's repo writes do, and an override would still repeat the event and the masking.
