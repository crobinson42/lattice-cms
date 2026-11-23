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

- [x] Decided in [0032](../decisions/0032-the-admin-is-a-react-package-fed-by-the-served-catalog.md), which supersedes 0014:
  - **Features.** A list with a filter per field, one-column sort, Next and Back over cursors, and a count. Detail with population and links to referenced documents. Create and edit forms, where edit sends only the changed fields. Delete, which asks for confirmation and explains a `REFERENCED` refusal. Relation `list` and `set`. Withheld fields are absent. A method with an `id` input is a document action, and one without is a collection action. `VALIDATION` issues are shown at their fields.
  - **Left out.** Bulk actions, OR groups and multi-column sort, CSV import and export, saved views, dashboards, audit history, i18n, client-side validation, and per-collection custom pages or renderers.
  - **Delivery.** `<Admin fetch catalogUrl basePath header />` plus `@latticecms/admin/admin.css`, and nothing else public. The app serves the catalog JSON behind a session and keys `<Admin>` by organization.
  - **Dependencies.** Approved: peers `react` and `react-dom` `^19` and `@ts-pf/client`, `client-http`, `docs` and `protocol` `^0.6.0`. Dependencies `@shadalaya/react` `^0.1.0` and `swr` `^2`. devDependencies `tailwindcss`, `@tailwindcss/cli`, `@shadalaya/theme`, Testing Library, `happy-dom` and `@types/react`. The crm adds `react`, `react-dom` and `@latticecms/admin`, plus `vite` and `playwright` as devDependencies.
  - **Sign-in.** The crm signs in through `/auth`. A new `/auth` `organizations` procedure needs a session but no organization, and returns the caller's organizations with their names. The names come from a new crm `organizations` collection.
  - **Testing.** Component tests in `packages/admin` (vitest, Testing Library and happy-dom) against an in-memory app over `FetchLink`. One Chromium test in the crm, driven by the `playwright` library from vitest, against the HTTP server and mongod. CI installs Chromium from a cache.
  - **Budgets.** A test gzips the Vite build and asserts a size budget, set from the first measurement. The crm's admin UI gets its own tsconfig project, so the crm's 0.75 s server budget still measures the server.

### 2. UI metadata **Checkpoint**

- [ ] Catalog facts core already knows but does not emit, found at step 1:
  - a ref's target collection;
  - a machine-readable mark on a maskable field;
  - the sortable fields;
  - a method's summary and effect, declared once for the admin and MCP (the crm describes `deals.close` only in its MCP toolset);
  - the collection, operation and relation of each generated procedure, so no client guesses from path segments.
- [ ] Decide what the admin needs from a collection that the schema does not say: labels, a title field for references, list columns, field widgets and ordering.
- [ ] Decide where it is declared: on the collection, in Zod `.meta()`, or in procedure `.meta()` (which already flows into `catalog()`). It must not grow type-check cost per field (0003).
- [ ] A decision record.

### 3. The admin package

- [ ] `@latticecms/admin` as decided at steps 1 and 2, on `@ts-pf/client`.
- [ ] The crm mounts it at `/admin`, serves `/catalog.json` behind a session, and adds the `organizations` collection, the `/auth` `organizations` procedure and the switcher.
- [ ] The crm gains a `many()` relation (deal contacts), so the browser test covers relation `list` and `set`.
- [ ] The browser test and the bundle budget, as decided at step 1.
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

- `catalog()` cannot run in a browser: an app's runtime contract imports its methods' use cases. The admin renders the catalog the app serves ([0032](../decisions/0032-the-admin-is-a-react-package-fed-by-the-served-catalog.md)).
- `/rpc` refuses every call without an organization, so `memberships.find` cannot feed a switcher. The crm adds an `/auth` procedure (step 3).
- `@shadalaya/react` 0.1.0 needs React 19 despite its `>=18` peer range. `@shadalaya/theme` installs the shadcn CLI. The admin keeps the theme in devDependencies. A brief for shadalaya is in the maintainer's hands.
