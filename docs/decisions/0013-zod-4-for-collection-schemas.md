---
status: accepted
strength: default
date: 2026-11-20
revisit: Standard Schema gains a way to extend and introspect object shapes.
---

# 0013. Collection schemas are Zod 4

## Decision

`collection({ schema })` takes a Zod 4 object. `zod` is a peer dependency of `@latticecms/core`. Anything that only validates (method inputs, the actor) takes a Standard Schema, as hexok and ts-pf do.

## Why

Lattice adds system fields to a collection schema, derives patch and filter types from its shape, and reads field metadata. Standard Schema only validates; it cannot extend or describe an object.

## Rejected

- Standard Schema everywhere: not enough to build collections.
- TypeBox: the team's apps already use Zod 4.
