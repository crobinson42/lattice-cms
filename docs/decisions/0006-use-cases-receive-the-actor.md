---
status: accepted
strength: lock
date: 2026-11-20
revisit: Only with the maintainer.
---

# 0006. Use cases receive the actor and never import auth or HTTP

## Decision

The edge (the ts-pf context function) authenticates with `@hexok/auth` and builds the app's actor. Use cases receive it on their context. No Lattice code and no generated use case imports `@hexok/auth`, sessions, `Request` or `Response`.

## Why

It is hexok's rule, and it keeps auth replaceable: moving to the company IdP changes the composition root, not a use case. It also keeps use cases callable from workers, tests and `createLocalClient` with the same guards.
