---
status: proposed
strength: default
date: YYYY-MM-DD
revisit: The condition under which this decision is expected to be wrong.
supersedes: NNNN
---

# NNNN. Imperative title of the decision

<!--
Copy to NNNN-kebab-title.md with the next free number. Under about 300 words.
status: proposed | accepted | superseded. An agent writes `proposed`; only the maintainer sets `accepted`.
strength: lock (an invariant; only the maintainer changes it) | default (the current best answer; propose a replacement when it gets in the way).
supersedes: only when this record replaces another. Delete the line otherwise.
When this record is accepted and it supersedes NNNN, set `status: superseded` and `superseded_by: <this id>` on NNNN. Change nothing else there.
Then run `npm run decisions`.
-->

## Decision

What is decided, specific enough to check code against.

## Why

The constraint, incident or goal that makes this the right choice now.

## Rejected

- The alternatives someone is likely to propose again, and why not.
