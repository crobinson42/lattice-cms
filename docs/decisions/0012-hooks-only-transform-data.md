---
status: superseded
superseded_by: 0019
strength: default
date: 2026-11-20
revisit: A real case cannot be expressed as an entity method, an override or an event handler.
---

# 0012. Collection hooks only transform data

## Decision

Collections have three hooks: `beforeValidate`, `beforeChange` and `afterRead`. They transform data and nothing else. Business rules live in entity methods or overrides. Side-effects live in event handlers. Cross-cutting behavior (logging, timing, tracing) uses the family's hexok `hooks()`.

## Why

Payload-style frameworks drift into hook chains that hide control flow. Keeping hooks to data shaping keeps each operation readable in its use case.

## Rejected

- The v1 `beforeDelete`, `afterChange` and `onError` hooks: they duplicate overrides, events and `onCatch`.
