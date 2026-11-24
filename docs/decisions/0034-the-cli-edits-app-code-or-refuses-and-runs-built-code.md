---
status: accepted
strength: default
date: 2026-11-23
revisit: Apps stop sharing one composition shape, Node loads an app's TypeScript as it is, or the walkthrough's empty-app setup grows past a page.
---

# 0034. The CLI edits app code or refuses, and runs built code

## Decision

- **Three commands in Phase 3:**
  - `lattice collection <slug>` writes the collection, a test, and its registrations in the composition and the events catalog;
  - `lattice migration <name>` writes the next numbered migration and appends it to the list;
  - `lattice migrate` runs store-mongo's `migrate()`.
- **It edits or refuses.** The CLI parses an app file with the app's own TypeScript and inserts text where exactly one composition chain or events literal is. It never reprints the file. If the file has any other shape, it writes nothing, exits 1, and prints the lines it would have added and where. Every edit is computed before any file is written, and a second run is refused.
- **`migrate` imports a built module.** The app builds a module that exports `{ store, migrations }`. The CLI starts the store, runs `migrate()`, stops it, and sets the exit code. Ordering, history and locking stay in `migrate()`.
- **Config** is an optional `"lattice"` key in `package.json`, with static paths that default to the crm's layout.
- **A scaffolded collection** is open to any signed-in caller, inside tenancy. The command says to tighten it.
- **No app scaffold.** The walkthrough's script sets up an empty app, and the README follows it.

## Why

A collection touches three files, and a missed events entry is a compile error far from its cause. Inserting text at parsed positions keeps the developer's file as it was. Refusing with the exact lines is safe on any shape. Node 24's type stripping cannot load a typical app (`.js` specifiers, parameter properties), and deploys hold built code anyway.

## Rejected

- **Marker comments.** A moved marker breaks silently or writes in the wrong place.
- **Printing the lines only.** The walkthrough could not run it, and three hand edits invite the far-off error.
- **`lattice.config.ts` with tsx or jiti.** It needs a loader dependency and source code in production.
- **`lattice new`.** A second copy of the reference app to keep in step with core.
- **commander or citty.** Three flat commands do not need a framework.
