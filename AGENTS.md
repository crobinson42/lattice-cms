# AGENTS.md

Lattice CMS is a TypeScript framework for internal tools, CRMs, admin panels and portals. A collection definition compiles into hexok use cases, hexok event classes and a ts-pf contract. This file is for agents working on this repository.

## Where things are written down

| You need | Read | How it changes |
| --- | --- | --- |
| The current design | [`docs/architecture.md`](docs/architecture.md) | Edited in place, in the same PR as the code. It states what is true now: no history |
| Why a choice was made | [`docs/decisions/README.md`](docs/decisions/README.md), then only the records that bear on your task | A new record supersedes an old one. Accepted records are never rewritten |
| What to do now | The current phase plan in `docs/plans/`, when one is active. None is: Phase 3 is done, and Phase 4 starts when the maintainer asks (the phase table in `docs/architecture.md`) | Ticked as you go. Deleted when the phase exits |
| What a package does | Its `README.md` | Edited in place |
| History | `git log` | Never loaded by default |

Do not read superseded records or old plans unless the maintainer asks. Before you write code that uses hexok or ts-pf, read their READMEs and the matching agent skills.

## Decisions

A decision record is the current best answer and its reason. It is not a law.

- **`lock`**: an invariant. Follow it. If a task conflicts with it, stop and ask the maintainer.
- **`default`**: follow it until following it makes the code worse. Signs: a workaround, a shim, a cast, a second code path, or code that fights the design. Then stop. Write a `proposed` record that supersedes it, from [`TEMPLATE.md`](docs/decisions/TEMPLATE.md), with the evidence, and ask the maintainer. Do not build around it, and do not quietly ignore it.
- Every record has a **revisit** line: the condition under which it is expected to be wrong. When that condition holds, say so.
- **`proposed`** records are context, not rules.
- Write a record only for a choice someone could undo without knowing why: a rejected alternative likely to come back, deliberately unusual code, a new rule for future code, or a changed contract. Bug fixes, task notes and anything Biome enforces do not get records.
- Agents write `proposed` records. Only the maintainer sets `accepted`. When an accepted record supersedes another, the old one gets `status: superseded` and `superseded_by: <id>`, and nothing else in it changes.
- Run `npm run decisions` after any change in `docs/decisions/`. `npm run lint` fails when the index is stale or a record is invalid.

## Before 1.0, refactor instead of working around

Nothing is published and nothing depends on Lattice ([0017](docs/decisions/0017-breaking-changes-are-free-before-1-0.md)). When the right fix changes a public type, an API, a test or a decision, make that change. Do not add a shim, an adapter, a compatibility flag, an optional parameter or a second code path to avoid touching existing code. A fix that seems to need a workaround is a sign the design needs another look: use plan mode, think it through, and propose the change.

## Ask before you build

Stop and ask the maintainer before you:

- add a public export, a package, a runtime dependency or a config option the phase plan does not name;
- change a type signature that `docs/architecture.md` shows;
- pick between two designs that the plan leaves open.

Give the options, what each costs to maintain, and your recommendation. A fix that restores behavior the plan already promises needs no question.

## Invariants

These are the `lock` records. Their reasons are in the records.

- Depend on hexok and ts-pf. Generated code is real `UseCase`, `Port`, `Adapter`, `EventCatalog`, `Errors` and `router`; no parallel primitives. Never edit hexok or ts-pf from here ([0001](docs/decisions/0001-build-on-hexok-and-ts-pf.md)).
- No database joins ([0004](docs/decisions/0004-no-database-joins.md)).
- Access and tenancy are filters in the query, never load-then-check ([0005](docs/decisions/0005-access-and-tenancy-are-query-filters.md)).
- Use cases receive the actor and never import auth or HTTP ([0006](docs/decisions/0006-use-cases-receive-the-actor.md)).
- Collection events stay inside the product ([0010](docs/decisions/0010-collection-events-stay-in-the-product.md)).

Write only the code the phase needs. Keep one behavior in one place. Do not add helpers, options or abstractions for a case nobody has asked for.

## Layout

npm workspaces with Turbo. Node 24 (`.nvmrc`), engines `>=22.11`. ESM only.

- `packages/core`: `@latticecms/core`.
- `packages/store-mongo`: `@latticecms/store-mongo`: `MongoStore` and `migrate()`.
- `packages/admin`: `@latticecms/admin`: the React admin that renders an app's served catalog.
- `packages/cli`: `@latticecms/cli`: the `lattice` command.
- `packages/docs`: `@latticecms/docs`, private: the Starlight site at crobinson42.github.io/lattice-cms. Its pages come from the READMEs; the generated ones are gitignored.
- `examples/crm`: the example app. Private. Its admin page is `src/web`, served at `/admin`.
- `docs/`: architecture, decisions, plans. `scripts/decisions.mjs`: the decisions index.

## Commands

Run from the repository root.

```bash
npm install
npm run lint         # decisions index check + biome
npm run type-check
npm run test         # vitest
npm run build        # tsc -b
npm run decisions    # regenerate docs/decisions/README.md
npx playwright install chromium   # once, for the crm's browser test
npm run dev -w @latticecms/docs   # the docs site, at localhost:4321/lattice-cms/
```

Scope a task with a Turbo filter: `npx turbo run test --filter=@latticecms/core`. Format and fix with `npx biome check --write .`.

CI (`.github/workflows/ci.yml`) runs `lint`, `type-check`, `test` and `build` on every pull request and push to main. A release is the "Version Packages" pull request that the Release workflow opens from `.changeset/`; merging it publishes to npm. The Pages workflow deploys the docs site on every push to main.

## Before you finish

Run `lint`, `type-check`, `test` and `build`, in that order. All four must pass. Then update, in the same change:

- the package `README.md`, when public behavior changed;
- `docs/architecture.md`, when the design or a signature it shows changed;
- a decision record, when a recorded choice changed;
- the phase plan: tick what is done, and add anything you learned to its Discoveries section;
- `examples/crm`, when it uses what changed.

When a phase exits, move anything durable from its plan into `docs/architecture.md` or a record, then delete the plan.

## Code

- Biome formats and lints: single quotes, semicolons, trailing commas, two spaces.
- `tsconfig.base.json` sets `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`. Import types with `type`. Relative imports end in `.js`.
- Tests sit next to the source as `src/**/*.test.ts`. Prefer tests through the public API (`build()` and `createLocalClient`).
- A package's public API is its `src/index.ts`.
- A comment explains why code is unusual. Put it next to that code, not in a doc.

## Adding a package

Copy `package.json`'s scripts and its `files`, `license` and `publishConfig` fields, `tsconfig.json`, `tsconfig.check.json`, `tsconfig.dist.json`, `dist-check/`, `vitest.config.ts` and `LICENSE` from `packages/core`. `dist-check/` type-checks the built declarations as an app sees them, with `skipLibCheck` off. Add the package to the root `tsconfig.json` references. A package that will publish needs a changeset and a `README.md`, which is its docs page.

## Changesets and commits

Every change to a published package needs a changeset in `.changeset/`. Do not run `version-packages` or `release` by hand.

Conventional commits. The scope is the package name without `@latticecms/`, or `examples`, or `docs`. Do not commit or push unless the maintainer asks.

## Writing

Docs, READMEs, records and comments use short, plain, declarative sentences. Say what the code does. Match the voice of the hexok and ts-pf READMEs.
