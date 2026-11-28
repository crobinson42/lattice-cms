---
status: proposed
strength: default
date: 2026-11-27
revisit: ts-pf can type a procedure's output from a scalar input, so `count` could take `groupBy` and still type both outputs exactly.
---

# 0046. A grouped count is its own operation

## Decision

- Every collection gets a generated `countBy`. It takes `{ field, where?, limit? }` and returns `{ groups: { key, count }[], more }`. It runs `read` access and the tenant clause, as `find` and `count` do. `Repo.countBy` is its trusted twin.
- `field` names a field of kind string, number, enum or boolean, or an array of string, number or enum. The system fields are not groupable.
- `count` is the number of matching documents whose field holds `key`. An array counts each distinct element once per document. Missing, `null` and `[]` all count under `key: null`.
- Groups are sorted by count, highest first, then by key ascending, with `null` first. `limit` defaults to 1000, and 1000 is the most allowed. A result past the limit is cut there, and `more` is `true`.
- A `field` or `where` on a field withheld from the caller is `VALIDATION`, as a `where` and `sort` are. The tenant field is `VALIDATION` unless the call bypasses tenancy, since any other caller sees only its own tenant.
- `CollectionStore` gains `countBy`. MongoStore runs one aggregation: `$match`, `$project` and `$unwind` to each value's keys, then `$group`, `$sort` and `$limit`.

## Why

StaffDuty and DutyHire each show per-key counts on about ten screens: tickets per project, assignee, team or label. One `count` call per key cannot find which labels exist. Loading every document and counting does not scale. A counter on each document must change on every write path that moves a key.

The operation is not a `count` option, because ts-pf types an output from a list of expansions, not from a scalar input. As an option, every `count` caller would get an optional `groups` field, and every `countBy` caller an optional `groups` and a meaningless `count`.

A cut with `more` keeps a working screen working when data grows. A `VALIDATION` error at 1000 groups would break it on data the caller cannot see in advance. Sorting by count makes the cut keep the largest groups.

It aggregates one collection, so there is no join (0004). Access and tenancy are filters in `$match` (0005).

## Rejected

- **`count({ groupBy })`.** Its output type would carry both shapes as optional fields.
- **`VALIDATION` past 1000 groups.** It fails on data growth, not on a bad request.
- **`Record<key, count>`.** JSON object keys are strings, so a number, boolean or `null` key would be lost.
- **A distinct-values operation.** A grouped count answers the same question and also gives the counts.
