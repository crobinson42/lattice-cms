---
status: proposed
strength: default
date: 2026-11-27
revisit: A product needs a value to be unique across tenants, such as a public handle, and a global collection cannot hold it.
---

# 0044. A tenanted unique index includes the tenant field

## Decision

- On a tenanted collection, every unique index includes the tenant field, anywhere in its keys. Leaving it out is a compile error and a throw in `collection()`.
- A non-unique index may leave it out, such as a lookup across tenants.
- Lattice does not add the field for you: the index's keys are the ones declared.

## Why

A unique index without the tenant field clashes across tenants. Two organizations could not both hold the same name. And a `CONFLICT` would tell one tenant that a value exists in another, which breaks strict isolation ([0009](0009-strict-tenant-isolation-in-v1.md)). No product asked for that rule, and it is easy to write by accident.

## Rejected

- **Adding the tenant field to a unique index silently.** The declared keys would not be the index's, and its key order would be a guess.
- **A warning.** It does not stop the leak, and nobody reads startup warnings.
- **An opt-out flag for a cross-tenant unique value.** That value belongs in a global collection, whose index says what it means.
