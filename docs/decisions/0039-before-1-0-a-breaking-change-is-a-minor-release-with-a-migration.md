---
status: proposed
strength: lock
date: 2026-11-27
revisit: Lattice reaches 1.0, or an app needs a fix on an older minor line.
supersedes: 0017
---

# 0039. Before 1.0, a breaking change is a minor release that says how to migrate

## Decision

- **Breaking changes are still allowed before 1.0.** When the right fix changes a public type, an API or a decision, change it. Do not add a shim, an adapter, a compatibility flag or a second code path to keep the old shape.
- **A breaking change ships as a minor release** (0.3.0 to 0.4.0). A patch never breaks. Each published package's peer range on another moves with the minor, so an app upgrades them together.
- **Its changeset starts with "Breaking"** and says what to change in an app, with a before and after when the code is short.
- **Lattice fixes forward.** There is no backport to an older minor line.

## Why

[0017](0017-breaking-changes-are-free-before-1-0.md)'s revisit condition holds: StaffDuty and DutyHire depend on 0.2.0 from npm. 0017's reason still stands: early workarounds become permanent complexity. What changed is that a breaking change now costs each app an upgrade. Semver's 0.x rule (a caret range does not cross a minor) keeps an app on its minor until it chooses to move. A migration note makes that move cheap.

## Rejected

- **Deprecate, then remove a release later.** Each deprecation is a second code path while it lasts. With two apps and one maintainer, a migration note costs less.
- **Go to 1.0 now.** Phase 4 still changes tenancy and the event path. 1.0 waits until the API has held still under real products.
- **Backports to older minors.** No app has asked, and the apps upgrade with Lattice.
