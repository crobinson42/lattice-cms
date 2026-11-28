---
status: proposed
strength: default
date: 2026-11-27
revisit: An app needs a Lattice code to carry data of its own to its clients, and a declared app error cannot carry it.
---

# 0045. Lattice errors are final at the client boundary

## Decision

- A `LatticeError` reaches a client with Lattice's code, message, status and data. The app's `errors.map` never sees one.
- Lattice shapes a client's error once, in core: a `CONFLICT` leaves out the collection's tenant field.
- `build().clientError(error)` gives an app's own router the same error the procedures send, and core exports `latticeErrors` for that router's `.errors()`. So a sign-in or public-read router answers in the same shape.
- An app that needs another answer throws its own declared error from an override or a method.

## Why

Typed clients, the `ApiError` union of every procedure and the admin's error display read each Lattice code as one shape. If an app could reshape `CONFLICT` or `NOT_FOUND`, the same code would carry different data in each app, and a shared client could not trust its types. DutyHire's one reason to reshape `CONFLICT` was the tenant field, which core now drops.

## Rejected

- **Calling the app's `map` after Lattice's mapping.** Each app's clients would see different data under one code.
- **Dropping the tenant field in each app's gateway.** The gateway and the procedure routes would disagree.
- **A free `toClientError(error)` export.** It cannot drop the tenant field without knowing each collection's tenant, which only the built app knows. DutyHire's copy of the status table sent a gateway's `NOT_FOUND` as a 500 before it was written.
