---
status: accepted
strength: default
date: 2026-11-24
revisit: An app needs a role that may set a field it may not read on an existing document, or a field rule needs separate read and write rules.
---

# 0035. A caller cannot update a field withheld from it

Extends [0031](0031-masked-fields-are-withheld-at-the-client-boundary.md). 0031 stands: a field rule still decides reads, once per call, through `Access.readable`.

## Decision

- On update, a patch that names a field withheld from the caller is `VALIDATION` at that field's path, whether its value is a value or `null`. The family guard that refuses a `where` or `sort` on a withheld field checks it, before `execute`, on every path, overrides included.
- Create keeps blind writes. A caller who cannot read a required maskable field must still create the document, as a member creates a deal with its amount.
- In an update patch, `null` clears an optional field that has no default: the key is removed. A nullable field stores `null`. A required or defaulted field refuses `null` at its path.

## Why

A caller who cannot read a field cannot see what an update would destroy, whether it overwrites the value or clears it. Refusing it in the guard that already refuses queries on withheld fields keeps one rule in one place. `null` as "clear" is JSON Merge Patch's convention, and the stores already remove a key set to undefined.

## Rejected

- **Refusing only `null`.** Overwriting with a value destroys the same data.
- **A separate write rule per field.** The read rule already says who may see the value, and no app needs the two to differ.
- **An `unset: [...]` key.** It reserves a field name, and gives a field's next state two channels.
- **Refusing blind writes on create.** A member could no longer create a deal.
