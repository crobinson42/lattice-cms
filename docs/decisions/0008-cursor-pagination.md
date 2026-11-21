---
status: accepted
strength: default
date: 2026-11-20
revisit: The admin needs jump-to-page on large collections.
---

# 0008. Cursor pagination, with an opt-in total

## Decision

`find` takes `limit` and an opaque `after` cursor, ordered by the `sort` fields plus `id`. `withTotal: true` adds a `total` from a second `count` query. Page numbers are not offered.

## Why

Skip-based pages slow down on large Mongo collections. Most API callers do not need a total, so it costs nothing unless asked for.
