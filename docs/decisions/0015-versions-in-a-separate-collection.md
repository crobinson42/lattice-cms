---
status: accepted
strength: default
date: 2026-11-20
revisit: Phase 4 starts, or a product needs versions earlier.
---

# 0015. Versions and drafts live in a separate collection

## Decision

A versioned collection gets `<slug>_versions`, a real collection with its own access and tenancy. A draft is a version with status `draft`. Built in Phase 4.

## Why

The main collection stays lean and its queries stay simple. History on the document grows without bound and risks MongoDB's 16 MB document limit.
