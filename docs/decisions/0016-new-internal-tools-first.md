---
status: accepted
strength: default
date: 2026-11-20
revisit: Phase 2 exits with one internal tool in production.
---

# 0016. New internal tools adopt Lattice first

## Decision

Only new internal tools adopt Lattice. StaffDuty, THERMS and the other products keep their current code. No retrofit work is planned.

## Why

Retrofitting means wrapping existing repositories as a `CollectionStore` before the API has settled. New tools prove the design without that cost.
