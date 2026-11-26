# The crm app

`examples/crm` becomes a working CRM: a React single-page app at `/` for the people who sell, on the same Lattice API, with the generic admin kept at `/admin` as the back office. It is the example a reader copies, so its layout, names and data flow must be obvious on first read. Design: [`../architecture.md`](../architecture.md). Decisions in force: [`../decisions/README.md`](../decisions/README.md).

This plan is a working document. It is deleted when the exit holds, after anything durable in it has moved to `architecture.md`, the crm README or a decision record.

## Exit

- [ ] A reader runs `cp .env.example .env`, `docker compose up -d`, `npm run seed` and `npm run dev` in `examples/crm`, signs in as a seeded user, and works a pipeline: companies, contacts, deals on a board, activities, tasks, a dashboard and the team.
- [ ] The SPA lives in `src/web`, on wouter, `@shadalaya/react` and `@shadalaya/theme`, with data through `@ts-pf/swr` and a client typed by `typeof contract` from a type-only import. No server code is in the bundle, and no call site needs a cast or a type annotation.
- [ ] Every resource has one home under `src/web/resources/<resource>/`, with the roles the app uses (see the profile below). Pages own fetching; resource components take data and emit events. Every data-bound role has loading, empty and error states.
- [ ] `<Admin>` is mounted at `/admin`, lazily loaded, behind the same session and organization. Its browser test still passes.
- [ ] A second browser test drives the SPA: sign-in, the board, a deal's detail, logging an activity, completing a task, and an organization switch. Bundle budgets cover the SPA and the admin separately. The web type-check has a budget.
- [ ] The crm README tells the app's story in its current shape, and records the resource UI profile.
- [ ] `npm run lint`, `type-check`, `test` and `build` pass at the root.

## Decided

The maintainer chose these on 2026-11-25.

- **Domain: core CRM.** Activities (notes, calls, emails and meetings on a company, contact or deal), tasks (title, due date, done, assignee), deal owners, and a display name on memberships. Members read their organization's memberships, so a team list and an owner picker need no join (0004). A few fields that a real CRM has: phone, job title, industry, expected close date.
- **Admin: kept at `/admin`.** The SPA serves at `/`. `<Admin>` is a route inside it, with the same session.
- **Data layer: `@ts-pf/swr` and `swr`.**
- **Overrides can call the generated operation** ([0036](../decisions/0036-an-override-can-call-the-generated-operation.md), proposed; the maintainer chose this design on 2026-11-25). A core change, made in step 1c, so `deals.update` and `deals.create` can refuse a won or lost stage without copying core's update.
- **The crm server's type budget is 520k** (it was raised to 660k while the upstream fixes were pending, then lowered after hexok 2.2.8 and ts-pf 1.0.1). Activities, the seventh collection, cost about 100k where the sixth cost 40k. Step 1d finds the type that grows with the number of collections, and brings the budget back down.
- **The store port's `FindQuery` gains `optional`**, the sort fields a document may lack, filled by core (maintainer, 2026-11-25), so Mongo keeps its index-served sorts.
- **Core sorts optional fields, with missing values last** ([0037](../decisions/0037-an-optional-field-sorts-with-missing-values-last.md), proposed; the maintainer chose it on 2026-11-25), in step 1f, so Tasks sort by due date and deals by expected close date.
- **Checkpoint 4 (2026-11-26):** the maintainer approved the Companies pattern for the other resources. The app uses shadalaya's Atalaya palette (`@shadalaya/theme/atalaya.css`), the admin included. The top bar shows a breadcrumb instead of repeating the page title.
- **Approved dependencies for the crm:** `wouter`, `@shadalaya/react`, `@shadalaya/theme`, `swr`, `@ts-pf/swr`, `@ts-pf/client` and `@ts-pf/client-http` as dependencies of the page; `tailwindcss` and `@tailwindcss/vite` as devDependencies; `lucide-react` for icons (added 2026-11-25). Anything else is asked for first.

## In scope

The crm's domain, its dev loop, its HTTP edge where the SPA changes it, the SPA, its tests and its README.

## Out of scope

Changes to `packages/*` other than steps 1c to 1f, unless a step is `BLOCKED` on a real gap and the maintainer agrees. Products and line items, pipeline stages per organization, email sync, file attachments (uploads wait for `@hexok/blob`), reports and aggregates beyond counts, notifications, real-time updates, i18n, a mobile layout beyond what shadalaya's sidebar gives for free, signup and password reset. Do not add options for them.

## Resource UI profile

What the SPA follows, so a reader or agent can predict where a component lives.

- Platform: web, React 19.
- Resource home: `src/web/resources/<resource>/`, one per collection the SPA shows: `companies`, `contacts`, `deals`, `activities`, `tasks`, `members`.
- Naming: `<Resource><Role>`, kebab-case files: `deal-stage-badge.tsx` exports `DealStageBadge`. Roles: Inline, Badge, Card, Table (with its column definitions), List, Select, Form, Board (deals only), Timeline (activities only), and Detail sections. Formatters in `<resource>.format.ts`. Build only the roles a page uses.
- Primitives: `@shadalaya/react`, with the Atalaya palette. App-wide pieces that know no resource live in `src/web/ui/`, and every resource reuses them: `PageHeader` (the page's h1, its breadcrumb and focus), `DataTable` and `Column<T>`, `useCursorPages` and `LoadMore`, `SearchBox`, `SortSelect`, `useListParams`, `useFormSubmit` and `FormSheet`, `TextField`, `ConfirmDelete`, `SearchSelect` (a remote-search picker), typed field lists (`FormField<I>` with parsers `text`, `number`, `isoDate` and `oneOf`, checked against the contract's input) with `fillCreate` and `fillPatch`, `CursorTable`, `Section`, `ConfirmAction`, `SelectField`, `useAfterWrite` (the one path after a write: toast, fresh reads, navigation), `DetailList`, the states, and `format.ts`. People come from `useTeam()` behind `TeamGate`, which only role- or member-dependent pieces wait for. A resource's `<resource>Fields` is its only list of form fields.
- Data: `src/web/api.tsx` makes the typed client and its swr utils (`useApi()`), with a fresh cache per organization. Pages (`src/web/pages/`) and `src/web/workspace/` (the shell's composition: sections, the signed-in member, the user menu) call `useSWR` and mutations, and pass data down.
- Session: `src/web/session.tsx` (storage, the session's fetch, `next` paths, `useSession`) and `src/web/signed-in.tsx` (the gate, organizations, `useSignedIn`). A resource component never fetches, except a Select that searches, which takes its search function as a prop.
- Routes: `src/web/app.tsx` holds every route, so the route table reads in one place.

## Steps

Each step ends with its tests passing. Tick it when the orchestrator accepts it, and commit it as `feat(examples): …`.

### 1. The domain

Sent as 1a (fields, rules, members) and 1b (activities and tasks).

- [x] Companies gain `industry` and `phone`, both optional. Contacts gain `phone` and `title` (job title), both optional.
- [x] Deals gain `ownerId` (a user id, optional: unassigned is allowed) and `expectedCloseDate` (an ISO date, optional). Stages become `lead`, `qualified`, `proposal`, `negotiation`, `won`, `lost`.
- [x] A closed deal cannot change: the update access filter adds `closedAt: { exists: false }`, so it answers `NOT_FOUND` as an archived deal does (1a). Create and update refuse a won or lost stage, or a `closedAt` (1c).
- [x] `activities`: `kind` (`note`, `call`, `email`, `meeting`), `body`, `occurredAt` (date-time), `authorId`, and optional refs `companyId`, `contactId` and `dealId`, which cascade on delete. Tenanted. The author is the caller, never the client: there is no generated `create` access, and an `activities.log` method stamps `authorId` from the actor. Only the author updates or deletes an activity, as an access filter (0005). At least one parent ref is required: added in step 1e, once a refined schema with refs builds.
- [x] `tasks`: `title`, `dueDate` (an ISO date, optional), `done` (default `false`), `assigneeId` (a user id, optional), and the same three optional parent refs, which cascade. Tenanted. Any member reads and writes them.
- [x] Memberships gain a required `name`, the member's display name in that organization. Read access becomes the caller's organization (support reads all). A migration backfills `name` from `userId`, written with `lattice migration`. `dev:user` takes a name. `/auth` `organizations` is unchanged.
- [x] The events catalog, the MCP toolset, the OpenAPI and codegen snapshots, and every README and skill quote follow. Tests through `build()` and `createLocalClient` cover each new rule: the close-only rule, the log method's author, author-only edits, cascades, and team reads.
- Applies: 0004, 0005, 0012, 0018, 0019, 0021, 0028, 0031, 0035.

### 1c. Overrides call the generated operation

- [x] Core: `build()`'s overrides factory receives `generated`, and core exports `CreateInput<C>` and `UpdateInput<C>`, as [0036](../decisions/0036-an-override-can-call-the-generated-operation.md) says. Guards, logging and spans run once. Tests through `build()`; the core README, the agent skill and `architecture.md` (orchestrator) follow. A changeset.
- [x] The crm: `UpdateDeal` and `CreateDeal` refuse `stage` `won` or `lost` and any `closedAt` with `VALIDATION` at that path, naming `deals.close`, then call the generated operation. `deals.close` is the only way to close a deal.
- [x] Re-measure core's and the crm's type-check against their budgets.

### 1d. Flat type cost per collection

- [x] Found (FINDINGS 1d, measured with a fixture of 2 to 12 collections). Lattice's own types cost a flat ~4k per collection. Two upstream causes:
  - hexok's `family()` intersects its statics with `Spec`: about 38k per collection that has a hand-written use case. That's why activities, with `activities.log`, cost ~100k.
  - Corrected by ts-pf's investigation: Lattice's read procedure types cost O(N) each on first deep evaluation (step 1g). ts-pf also halved `all()`'s own share (ts-pf#74).
- [x] Briefs for both, which the maintainer hands to the hexok and ts-pf teams: [`../briefs/hexok-family-statics.md`](../briefs/hexok-family-statics.md) and [`../briefs/ts-pf-mcp-all-tools.md`](../briefs/ts-pf-mcp-all-tools.md).
- [x] Upgraded to hexok 2.2.8 and ts-pf 1.0.1. The crm server check went from 647k to 499k and the web check from 497k to 353k. The crm budget is now 520k.

### 1e. A refined schema with refs builds

- [x] Core: a collection whose schema has an object-level `.refine()` and a ref builds its contract, and populates. Today `expansionOf` (`populate.ts:102`) extends `clientOutput`, which carries the refinement, and Zod refuses. Outputs should not carry input refinements. A core test with a refined, populated collection. A changeset.
- [x] The crm: activities and tasks require at least one parent ref, with `VALIDATION` at `companyId`. Tests on create and update.

### 1f. Optional fields sort, missing last

- [x] Core and every store, as [0037](../decisions/0037-an-optional-field-sorts-with-missing-values-last.md) says: `SortKey` takes optional and nullable fields, missing values come last in both directions, and the cursor records a missing value. The store conformance suite covers paging across the boundary, ascending and descending, on MemoryStore and MongoStore. The admin's sort control offers those fields. A changeset.

### 1g. Read procedure types cost the same at any size

Before the SPA, whose typed client evaluates every procedure.

- [x] Find why touching `'~pf'` on each read procedure (`get`, `find`) costs more as collections are added: 567, 653 and 830 instantiations per procedure at 6, 12 and 24 collections. ts-pf's leads are the types generic over the whole entries map: `Slice<E, E[S], D>`, `ReadOr`/`Read`/`Wide`/`Expanded<E, …>` and `Target<E, Slug>`, and `E` built as a growing intersection per `.collection()`. A naive `Flat<…>` made it worse. Measure with `docs/briefs/measure-collections.py`.
- [x] Make a read's type depend only on its own collection and its refs' targets, not the whole map. No public API change. Re-measure core, the crm server check and the admin, and add a guard: per-procedure cost at 6 and 24 collections within a bound.
- Outcome: no flat shape that keeps the API. The slope is accepted and guarded by `npm run type-cost` in CI ([0038](../decisions/0038-a-ref-names-its-target-by-slug-and-populated-reads-keep-their-type-slope.md), proposed).

### 2. The dev loop

- [x] `docker-compose.yml`: MongoDB 8 as a one-node replica set that initiates itself, and Redis 7. `docker compose up -d` is the whole setup.
- [x] `.env.example` with every variable and working local values; `.env` is gitignored. Every script loads `.env` when it exists (`node --env-file-if-exists`), so no `export` is needed.
- [x] `npm run seed`: two organizations; Ann, a manager in both, and Ben, a member of one, with known passwords; companies, contacts, deals in every stage with owners, activities and tasks, some due and some overdue. It writes business data through `createLocalClient` as those users, so the seed passes the same access and hooks as the app, and writes users, organizations and memberships as trusted code, as `dev:user` does. It needs only MongoDB. Run twice, it refuses and says how to reset.
- [x] `npm run dev`: the server, the worker and Vite together, each reloading on change. At most two new devDependencies; name them in `DONE`.
- [x] The README's Run it section is those three commands, plus the sign-in details.

### 3. The edge

- [x] Split `servers/http/handler.ts` by concern: the session and actor checks, the MCP edge, the static page, and the routing that ties them. Each file reads top to bottom. No behavior change; the existing tests pass unchanged.
- [x] The page serves at `/`: `GET` on any path that is not an API path gets `index.html`, and `/assets/` gets hashed files cached for good. The API paths stay as they are. Vite's `base` is `/`, and its proxy covers every API path.

### 4. The SPA foundation **Checkpoint**

- [x] Tailwind v4 through `@tailwindcss/vite`, with the shadalaya theme. `src/web/api.ts`: the `/rpc` client typed by `typeof contract` and its swr utils, and the `/auth` client. `SWRConfig` is keyed by organization, so a switch starts with an empty cache.
- [x] The session: sign-in page, token and organization in `sessionStorage` as today, sign-out, a 401 signs out.
- [x] The shell: shadalaya's sidebar with Dashboard, Companies, Contacts, Deals, Tasks and Team; the organization switcher; the user menu with Admin and Sign out. Support, which acts in no organization, is sent to `/admin`.
- [x] `<Admin>` at `/admin` through `React.lazy`, with a link back to the app in its header.
- [x] `src/web/ui/`: loading, empty and error states, and money and date formatters.
- [x] Companies as the first resource, end to end, as the pattern the other resources copy: list with search and cursor pages, detail, create and edit in a sheet, delete with a `REFERENCED` refusal explained.
- [x] Measure the web type-check and the bundles; propose budgets.
- **Checkpoint:** show the maintainer the running app, the folder layout and the measurements before the pattern is repeated.

### 5. Contacts and deals

- [x] Contacts: list, detail, form, with the company as `CompanyInline` and `CompanySelect`, and a company's contacts on its page.
- [ ] Deals: a board with a column per open stage, moving a deal between open stages, and Won and Lost through `deals.close` with a confirmation. A table view. Detail with the deal's contacts and roles through the relation's `set`, the owner as `MemberInline`, and the amount shown as withheld, not zero, to a member.
- [ ] Members: `MemberInline`, `MemberAvatar` and `MemberSelect`, fed by the team read.

### 6. Activities and tasks

- [ ] `ActivityTimeline` and an activity composer that calls `activities.log`, on company, contact and deal detail.
- [ ] Tasks: the Tasks page (mine first, then overdue, due and done), a task form, and done as one click. A task list section on each parent's detail.

### 7. Dashboard, team and search

- [ ] Dashboard: open deals by stage (counts through `count`), my tasks due and overdue, recent activities.
- [ ] Team: the organization's members and their roles.
- [ ] Search: a command palette over companies, contacts and deals by title field.

### 8. Tests and docs

- [ ] The SPA browser test (see Exit). Bundle budgets for the SPA and the lazy admin chunk. The web type-check budget.
- [ ] The crm README: what the app is, how to run it, a tour of the layout (domain, app, infra, servers, web), the resource UI profile, then the existing sections on events, MCP, OpenAPI, auth and tests.
- [ ] The orchestrator moves anything durable into `architecture.md` and deletes this plan.

## Discoveries

- 1a: `dev:user` and `dev:session` take the member's name: `<userId> <name> <email> <password> <organization> [role]`.
- 1a: an update override cannot keep the generated update today (overrides get only `repos`, and core exports no patch type). That's the evidence for 0036 and step 1c.
- 1a: `deals.create` can set a won or lost stage too, so 1c covers create.
- 1a: nine optional fields cost the crm check about 16k (450k to 466k).
- 1a: the CLI's migrate test reads the crm's migrations instead of hard-coding them, so a crm migration no longer breaks it.
- 1c: `generated` first held every body, which let an override create rows with no create-access check. Now it holds only the declared overrides, and each body checks its own action's needs. The names became `CreateInput`/`UpdateInput`, because core/store already has a `Patch` with the opposite clearing rule.
- 1c: core's type cost went down (443k to 433k), because one shared generated use case class replaced two per-operation class factories.
- 1b: the seventh collection costs about 100k where the sixth cost 40k, whichever collection it is (step 1d). Test files count too: `tsconfig.check.json` includes them (1b's test file is about 16k).
- 1b: a refined collection schema with a ref throws at `.contract` (step 1e). `find` cannot sort on an optional field (step 1f).
- 1b: ts-pf's codegen profile renames hoisted schema names when collections are added, so generated client type names are not stable as an app grows (architecture.md, Known limits: OpenAPI names).
- 1e: outputs are built from the schema's fields plus the system fields, so an object-level refine checks input only. A generic schema-wrapping helper cost about 7k more than a shared `.refine(fn, options)`.
- 1f: Mongo needs to know which sort keys are optional to keep its index-served sorts, hence `FindQuery.optional`. An ascending optional key that is not first sorts in memory (an aggregate). That's acceptable for a rare sort, but worth an index-design note if a hot list needs it.
- 1d (corrected): `all(tk)` was not the quadratic part. Lattice's read procedure types are, on first deep evaluation (step 1g).
- 2: four commands, not three. `cp .env.example .env` runs once, so the scripts never fall back to the public dev secret. `npm run dev` needs no new dependency (`scripts/dev.mjs`), and rebuilds core and store-mongo through tsc's project references.
- 3: until the app exists, `main.tsx` sends any path outside `/admin` to it. Step 4's router replaces that placeholder.
- 4a: login returns `{ token, userId }`, and the session context carries `userId`. A request signs out only the session it was sent with. Signing in clears the old session's storage. `@latticecms/admin` cannot move focus to its own heading, so a sign-in that returns to `/admin` leaves focus on the body (a later admin step).
- 4a: the app at startup is 162.7 KB gzipped (95.2 KB without React). The lazy admin chunk is 24.2 KB. The web type-check is at 373k.
- 4b: cursor lists set `revalidateAll` and `dedupingInterval: 0`. SWR's filter `mutate` skips infinite keys, and a list that remounts within the dedupe window reused stale pages. `ApiError` is written out until ts-pf's `InferContractErrors` keeps protocol errors ([brief](../briefs/ts-pf-infer-contract-errors.md)).
- 4b: shadalaya's destructive button with Atalaya's red is 4.36:1, just under WCAG AA for 14 px text. A finding for shadalaya or Atalaya, not overridden here.
- 4b: the app at startup is 180.5 KB gzipped (113.0 KB without React); the admin chunk is 23.4 KB; the web type-check is at 390k.
- 5a: a populated read narrows only with the literal `populate` list in the call, so `useCursorPages(key, input, read)` takes a read that repeats it. Base UI's combobox hides everything outside its open popup from assistive tech, so a picker's live regions live inside the popup.
- 5a: startup is 197.3 KB gzipped (129.8 KB without React); the web type-check is at 413k. Populated reads cost about 9k more per resource than plain ones.
- 5b0: core's `ref()` refuses '' ("Choose the company"). Pages load lazily: startup went from 197.3 KB to 178.9 KB gzipped (111.3 KB without React). The largest page chunk is 26 KB (a company's page, with the contact form and combobox). Budgets are per startup, per largest page and per admin, read from Vite's manifest.
- 5b1: SWR 2.5.1 — to make a read fresh when nothing renders it, call a revalidating `mutate(key, undefined)`. `cache.delete` or `revalidate: false` leave a dedupe marker, so a hook remounted within the dedupe window stays on an older request whose result SWR drops.
- 5b1: a masked field reads as absent, and a required one that is absent means withheld. The caller's role decides only what is offered (the amount sort, the amount in a member's edit), from the team read; a refused read re-reads the role.
- 5b1: startup 179.7 KB gzipped (112.2 KB without React). The largest page chunk is 30.1 KB (a company's page). The web type-check is at 441k.
