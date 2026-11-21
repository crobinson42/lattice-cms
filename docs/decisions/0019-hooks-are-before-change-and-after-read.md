---
status: proposed
strength: default
date: 2026-11-20
revisit: ts-pf can skip input validation per procedure, or a real case needs to reshape input that would fail the schema.
supersedes: 0012
---

# 0019. Collection hooks are `beforeChange` and `afterRead`, and only transform data

## Decision

Collections have two hooks: `beforeChange` and `afterRead`. They transform data and nothing else. The generated write order is: validate input, `beforeChange`, store write, `afterRead` on every returned document. Business rules live in entity methods or overrides. Side-effects live in event handlers. Cross-cutting behavior (logging, timing, tracing) uses the family's hexok `hooks()`.

## Why

ts-pf validates every procedure's input at the edge, before any Lattice code runs, and can turn that off only for a whole server, not one procedure. A `beforeValidate` hook would therefore only ever see input that already passed validation. Over RPC it could never repair input, so it would promise something it cannot do. The rest of 0012 stands: Payload-style hook chains hide control flow, and keeping hooks to data shaping keeps each operation readable in its use case.

## Rejected

- Keep `beforeValidate` and have the app pass `validation: { input: false }` at every edge: one forgotten edge silently skips the hook, and handlers lose ts-pf's typed parse.
- The v1 `beforeDelete`, `afterChange` and `onError` hooks: they duplicate overrides, events and `onCatch`.
