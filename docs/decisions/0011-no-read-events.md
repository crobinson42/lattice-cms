---
status: accepted
strength: default
date: 2026-11-20
revisit: A product needs an audit trail of reads.
---

# 0011. Reads are logged and traced, not published as events

## Decision

Generated `find` and `get` emit no events. They are logged through the family's hooks and traced.

## Why

Read events are the noisiest stream in the system and no planned consumer needs them. A read audit, if one is ever needed, is a log or trace concern before it is an event concern.
