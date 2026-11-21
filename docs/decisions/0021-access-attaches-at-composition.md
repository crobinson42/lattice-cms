---
status: proposed
strength: default
date: 2026-11-21
revisit: A collection needs access rules that do not depend on the app's actor, or TypeScript gains partial type argument inference so `collection<Actor>('posts', …)` infers the rest.
---

# 0021. Access functions attach where the app composes, not on the collection

## Decision

A collection's access functions attach at composition, beside its methods and overrides: `framework({ family }).collection(Posts, { access: { read, update, publish } })`. Each function receives `{ actor }`, typed by the family's actor schema. `create` also receives `data`. `read`, `update`, `delete` and a method's own action return `boolean | Where<Doc<C>>`, or a promise of one. `create` returns `boolean`. A returned `Where` that names a field the collection lacks, or a key that is not an action, is a compile error.

## Why

The actor type lives on the family, and a collection names no family ([0018](0018-methods-and-overrides-attach-in-the-framework.md)). The composition site is the one place where the actor and the document type are both known, so access needs no type argument and no global there. A method's own action (`publish`) is keyed beside the method it guards, and a join collection's default (the parent's `update`) is in reach. The Phase 1 type spike showed that this checks access, and that it keeps `actor` contextually typed.

TypeScript does not check excess properties on an object literal that an arrow function returns. So each function's return type is inferred, and its keys are checked on the options object, not on `access`; a check on `access` itself loses `actor`'s type.

## Rejected

- `access` on `collection()`, typed by a type parameter: TypeScript has no partial inference, so this needs a curried `collection<Actor>()('posts', …)`, and every collection repeats the actor type.
- A `Register` declaration merge for the actor: one actor per TypeScript program, which breaks core's own tests and two apps in one program, and the actor's source is invisible where access is written.
