# Phase 3: Admin, uploads and CLI

Phase 3 turns the collection model into a working tool: an admin built from the contract, file uploads, and a CLI. It ends when a new app goes from install to a signed-in admin with CRUD in under a day. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md` or a decision record.

## Exit

- [ ] `@latticecms/admin` renders list, detail, create and edit views for every collection, from the contract's `catalog()` and procedure meta, with no per-collection UI code. It honors access, tenancy, population and field masking, as a ts-pf client does today.
- [ ] `examples/crm` serves the admin, signed in through its `/auth` router, with an organization switcher from `memberships`.
- [ ] A collection can declare a file field. Uploads go through `@ts-pf/file` and a blob port, scoped by tenant and checked by access, and the crm stores a deal attachment.
- [ ] `@latticecms/cli` scaffolds a collection and runs migrations.
- [ ] `@latticecms/core` ships an agent skill that walks a feature from collection to override.
- [ ] A tested walkthrough goes from `npm install` to a signed-in admin with CRUD on two collections. The README follows it.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root. Type-check time is re-measured against 0003, and the admin's bundle size is measured.

## In scope

The admin package, the UI metadata it needs, file fields and uploads, the CLI, the agent skill, and the crm using all of them.

## Out of scope

The outbox, versions and drafts, Postgres, a store per collection, and performance tooling (Phase 4). Running the crm in production. Do not add options for them.

## Steps

Each step ends with its tests passing. Tick it in this file when it does.

### 1. The admin's scope **Checkpoint**

- [ ] What the admin does in Phase 3:
  - a list with filter, sort, cursor pages and a `count`;
  - detail with population;
  - create and edit forms from input schemas;
  - delete, and relation `list` and `set`;
  - masked fields;
  - methods.
  Name what it leaves out.
- [ ] How it is delivered: a React package an app mounts (routes, a provider and the typed client), or a standalone SPA that reads the contract. How it reads the contract: `import type` and `catalog()`, or OpenAPI.
- [ ] `@shadalaya/react`: read it (npm 0.1.0). Decide what it provides, whether it is a dependency or a peer, and what is missing for tables and forms.
- [ ] How the admin signs in and picks an organization. It reuses the app's `/auth` and `x-organization-id`, and imports no auth code into Lattice (0006).
- [ ] How it is tested: component tests, a browser test, or both.

Propose before building.

### 2. UI metadata **Checkpoint**

- [ ] Decide what the admin needs from a collection that the schema does not say: labels, a title field for references, list columns, field widgets and ordering.
- [ ] Decide where it is declared: on the collection, in Zod `.meta()`, or in procedure `.meta()` (which already flows into `catalog()`). It must not grow type-check cost per field (0003).
- [ ] A decision record.

### 3. The admin package

- [ ] `@latticecms/admin` as decided at steps 1 and 2, on `@ts-pf/client`.
- [ ] The crm mounts it, with the organization switcher.
- [ ] A withheld field is absent in forms and tables, and a `VALIDATION` on a filter is shown, not swallowed. A `REFERENCED` delete explains which children block it.

### 4. Uploads **Checkpoint**

- [ ] A blob port. The proposed-changes table says `@hexok/blob` and `@hexok/blob-s3` belong in hexok. Ask the maintainer: wait for hexok, or start with a port in Lattice that moves to hexok later.
- [ ] A file field in a collection: what is stored (a blob key and metadata), how `@ts-pf/file` multipart reaches it, and how access, tenancy, masking and `onDelete` apply to the blob.
- [ ] Downloads: signed URLs or a streaming procedure. Nothing is served without the caller's access.
- [ ] The crm: an attachment on a deal, and the admin's upload field.

### 5. The CLI **Checkpoint**

- [ ] `lattice collection <name>`: scaffolds a collection, its registration in the contract, and a test, in the crm's layout.
- [ ] `lattice migrate`: runs `migrate()` from the app's own migration list. How the CLI loads the app's store and list: a config file, or an app entry it imports.
- [ ] Propose the commands and the config shape first.

### 6. The agent skill

- [ ] `skills/lattice/` in `@latticecms/core`, shaped like hexok's skill: collection, access, tenancy, relations, masking, an override, a method, an event handler and a test. Its examples are checked against the crm, as README quotes are.

### 7. The walkthrough

- [ ] A script, run in a test, that goes from an empty app with the published packages to the admin with CRUD on two collections. The README's getting-started section follows it step by step.

### 8. Docs

- [ ] The package READMEs, with recipes from `examples/crm`.
- [ ] `docs/architecture.md` matches what was built, and its Phase 3 markers are removed.
- [ ] Changesets.

## Carried from earlier phases

Candidates, not commitments. Each needs a reason from this phase's work before it is picked up. `architecture.md` "Known limits" and "Proposed changes" list them all.

- **`@hexok/authz`:** when hexok releases it, write the `Access` adapter. Decide how it composes with the declared access functions; today `build({ access })` replaces them wholesale.
- **ts-pf follow-ups:** a distributive `RouterImplCheck` (drops `rootRouter()`), and exported `ExpandResult` (drops `ReadUseCase`). Briefs are in the maintainer's hands.
- **hexok:** `EventClass`, an `around` hook, and peers in its adapter packages.
- **Relations:** self `many()`, `restrict` counting soft-deleted children, and population one level deep.
- **`Repo.update`:** it does not re-validate the merged document.
- **OpenAPI names:** stable component names through `.meta({ id })`.
- **Overloads:** 8 asserted overloads today. Watch the count.

## Discoveries

Add a line here when the work teaches something the plan did not know. Each line says what was found and where it went.

- None yet.
