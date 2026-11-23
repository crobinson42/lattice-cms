---
status: superseded
superseded_by: 0032
strength: default
date: 2026-11-20
revisit: Phase 2 exits.
---

# 0014. API first; the admin is Phase 3

## Decision

v1 ships collections, the HTTP API, the in-process client and MCP. The admin is a React app on `@shadalaya` that reads the ts-pf `catalog()` and procedure `.meta()`, built in Phase 3. It refetches after mutations and on focus with `@ts-pf/swr`; live updates come later if users ask.

## Why

The backend core decides the admin's shape. Building the admin first would lock in API guesses.
