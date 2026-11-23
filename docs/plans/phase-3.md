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
  - **Budgets.** A test gzips the Vite build and asserts a size budget, set from the first measurement. The crm's admin UI gets its own tsconfig project, so the crm's server budget still measures the server. Budgets count instantiations since step 3 (`architecture.md`).

### 2. UI metadata **Checkpoint**

- [x] Decided in [0033](../decisions/0033-the-catalog-carries-lattice-facts-and-the-admin-derives-its-ui.md): `x-lattice-ref` and `x-lattice-maskable` in Zod meta, an enum of sort keys, `lattice` procedure meta typed as the exported `LatticeMeta`, required `summary` and `effect` statics on a method, an optional `label` on `collection()`, and summaries that use it. The admin derives field labels, the title field, columns, order and widgets from the schema.
- [x] Core emits them. The crm's `CloseDeal` declares its summary and effect, and its MCP toolset drops its own entry for `deals.close`. Codegen's snapshot, the summaries' tests and README quotes follow.

### 3. The admin package

- [x] `@latticecms/admin`: the package, the catalog guard, the router, the index, lists (filter, sort, pages, count, query state) and detail. Core emits `x-lattice-tenant` and a relation's `target` (an addition to 0033 the maintainer approved).
- [x] Forms (create and edit), delete, methods, and relation `list` and `set` in the admin.
- [x] The crm serves `/catalog.json` behind a session, and adds the global `organizations` collection (a member reads its own; memberships ref it), the `/auth` `organizations` procedure (a session, no organization), and a deal `contacts` relation with a `role`. The dev scripts take an organization name.
- [x] Profile and cut a `many()` relation's type cost. Constraints use `z.core.$ZodType` (core −5.7%, crm −8.3% in instantiations). The crm's check skips declaration emit. Its budget stays 0.85 s: it measures 0.76–0.84 s.
- [x] The crm mounts the admin at `/admin`, with sign-in, the switcher and sign-out.
- [x] The browser test (Chromium through the `playwright` library, in vitest, against the server and mongod) and the bundle budget. CI installs Chromium from a cache.
- [x] A withheld field is absent in forms and tables, and a `VALIDATION` on a filter is shown, not swallowed. A `REFERENCED` delete explains which children block it. (Component tests; the browser test repeats them in the crm.)

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
- The mask marker's clone dropped the app's Zod meta on a maskable field, including a `title` or `.describe()`. It now keeps it (`parent: true`), which 0033's field labels need. In `architecture.md`.
- A `many()` relation costs an app about 35k type instantiations, a plain collection about 12k. The crm with tests went over 0.75 s, and the maintainer raised its budget to 0.85 s, with a profiling task next. In `architecture.md`.
- Profiled: a plain tenanted collection costs about 36k instantiations and a relation about 44k, much of it in ts-pf's MCP toolkit and hexok's `Event()` types. Briefs for both are with the maintainer. Wall time varies about 10% between days, so a budget in instantiations would be steadier. In `architecture.md`.
- The catalog had no tenant-field fact and no relation target, so the admin first inferred both. Core now emits `x-lattice-tenant` and `lattice.target`. In `architecture.md`.
- Every scalar Lattice field sorts except booleans and optional or nullable ones. A UI sort is refused only when the caller's field rules change mid-session, because columns follow what the caller receives.
- Core's update cannot unset an optional field, so the admin refuses to clear one. Known limit in `architecture.md`.
- Wall-clock type-check budgets drifted 10% or more between days on one machine, at a flat instantiation count. The maintainer moved the budgets to instantiations, +5% over today. In `architecture.md`.
- Each crm `start()` builds every index in a fresh database, so tests that start a real server on MongoDB stall each other when they overlap. They run one file at a time in the `servers` vitest project. A new server-starting test goes in that list.
- Tests that checked a JSON body for a secret number as a substring were flaky: random hex ids and database names can contain it. Secrets now have a fraction (`4242.5`), which no hex id holds.
