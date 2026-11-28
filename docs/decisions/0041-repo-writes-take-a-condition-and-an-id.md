---
status: proposed
strength: default
date: 2026-11-27
revisit: An app needs a condition on a generated update or delete from a client, or a conditional write that changes many rows at once.
---

# 0041. Repo writes take a condition, and an insert takes an id

## Decision

- `repo.update(id, patch, scope, { if })` and `repo.remove(id, scope, { if })` take a `Where` that the row must meet. The repo ANDs it with the scope, and the store checks it in the same `update` or `remove` call. A row that fails it is left alone, and the call returns null, as a missing row does.
- `repo.insert(data, scope, { id })` stores the row under a given id. An existing id is `CONFLICT`, as the store port already says. Generated create keeps server UUIDs: a client never picks an id. The `CONFLICT` is about the id in any tenant, so it tells the caller that the id exists. Server code should not pass it on to a client unchanged.
- Every `Where` a repo takes, in `find`, `count` and `if`, is checked at runtime as an access answer is. An undefined operand throws instead of dropping its clause.
- These are options on repos only. Clients and generated operations do not get them.

## Why

DutyHire books a slot once, and StaffDuty moves a request through states. Each did get-then-update, so two writers that read the same row could both write. The store port already takes a `Where` on `update` and `remove` for the scope, so a condition is one more clause in that same call, atomic on every store. A row that fails the condition looks the same as a missing one, so the caller decides which domain error it is, as it already does for null.

DutyHire keeps a projection per party that shares its record's id. With only server UUIDs, it needed a second lookup field and an index to find the projection.

A typed `if` can still hold `undefined` at runtime, from JavaScript, a cast or JSON. A dropped clause would make the guard always pass, so the check is the same one access answers get.

## Rejected

- **A `version` field that Lattice bumps on every write.** It fixes one pattern and adds a system field to every collection. A `Where` covers versions, states and counts.
- **A distinct "condition failed" result or error.** Callers already handle null for a missing row, and most treat both the same. One that needs to tell them apart can read the row afterwards.
- **A client-chosen id on generated create.** Ids would become guessable and collide across tenants. Server code that needs one has the repo.
- **An upsert.** Insert, then update on `CONFLICT`, covers the cases so far. It is in the Phase 4 backlog.
