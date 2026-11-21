---
status: accepted
strength: lock
date: 2026-11-20
revisit: Only with the maintainer.
---

# 0005. Access and tenancy are filters in the query

## Decision

Access checks return `boolean` or a `Where`. A `Where` and the tenant clause are merged into the store call (`find`, and the `where` argument of `get`, `update` and `remove`). Lattice never loads a row and then decides whether the caller may see it. `false` throws one `FORBIDDEN`; a row outside the filter is `NOT_FOUND`.

## Why

Load-then-check leaks existence, breaks pagination and costs a second read. A filter makes list queries and writes safe by construction, and lets `@hexok/authz` plug in later as an adapter of the `Access` port.
