---
status: accepted
strength: default
date: 2026-11-20
revisit: A product needs to share a record across organizations, or `@hexok/authz` ships cross-tenant grants.
---

# 0009. Strict tenant isolation in v1

## Decision

Row-level tenancy is the only strategy. A collection with `tenant: '<field>'` stamps that field on create and adds it to every filter. There is no cross-tenant sharing in v1. A platform actor may bypass tenancy through `tenancy.bypass(actor)`, and every bypassed call is logged.

## Why

It matches the team's organization model and keeps v1 simple. The tenant clause is one filter the `Access` port can widen later (own organization OR shared to me), so sharing arrives through `@hexok/authz` without changing collections.

## Rejected

- Access functions widening the tenant scope per collection: every collection writes its own sharing rule.
- A built-in shares collection: Lattice would own grant data that products should own.
