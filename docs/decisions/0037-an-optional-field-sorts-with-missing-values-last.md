---
status: proposed
strength: default
date: 2026-11-25
revisit: An app needs missing values first, or a store cannot page missing values without scanning the collection.
---

# 0037. An optional field sorts, with missing values last

Extends [0008](0008-cursor-pagination.md).

## Decision

- `sort` takes an optional or nullable field of a sortable kind, as it takes a required one.
- A row with no value (missing, `undefined` or `null`) comes after every row with one, ascending or descending. Rows with no value order among themselves by the remaining sort keys, then `id`.
- The cursor records that its row had no value, so `after` pages stay stable across the boundary. Every store passes the same conformance cases: MemoryStore, MongoStore and any later adapter.
- The store port's `FindQuery` carries `optional`, the sort fields a document may lack, filled by core from the output schema. A store needs it to keep a sort on required fields as it was: MongoStore already puts missing values last on a descending key, and only an ascending optional key needs another plan.
- A `where` on the field is unchanged.

## Why

The crm's Tasks page sorts by due date, and a task may have none. Deals by expected close date are the same. Without this, an app either makes the field required, which bends its domain around the framework, or splits one list into filtered buckets. Cursor pagination is why core refused it: a cursor predicate compares against the row's value, and a missing value has no place in that order until the order gives it one.

Last in both directions is what a person expects from a due date: undated work is neither the most urgent nor the least.

## Rejected

- **Missing first ascending, as Mongo sorts by default.** Undated tasks would head the urgent list.
- **A per-key `nulls: 'first' | 'last'` option.** Nobody needs it yet, and it doubles the cursor cases.
- **Treating every ascending key as possibly missing, with no port change.** MongoStore would sort `['-amount', 'title']` in memory instead of on an index.
- **Making optional fields required in the crm.** It hides a framework gap that every app with a due or close date meets.
