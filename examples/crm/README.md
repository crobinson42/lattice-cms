# examples/crm

A CRM on Lattice, for the people who sell: companies, contacts, deals on a pipeline board, activities and tasks, a dashboard, the team and search, each organization's own, on MongoDB. The app is a React page at `/`, on the same API as the generic admin at `/admin`. It is the example the `@latticecms/core` README quotes, and the app every Lattice change is checked against. It is private and never published.

## Run it

It runs as two processes, the HTTP server and the worker, on MongoDB (a replica set, for transactions) and Redis (sessions and the event queues). You need Node 24 and Docker. Once, from the repository root, `npm install` and `npm run build`: the crm runs on the built packages. Then, in `examples/crm`:

```bash
cp .env.example .env    # once: local settings, gitignored
docker compose up -d    # MongoDB 8 as a one-node replica set, and Redis 7
npm run seed            # two organizations, three users and a pipeline
npm run dev             # the server, the worker and Vite, each reloading on change
```

Open <http://localhost:5173/> and sign in. The app is at `/`, the admin at `/admin`, and the API on port 3000.

| Name | Email | Password | Can |
| --- | --- | --- | --- |
| Ann Lee | `ann@example.com` | `a long password` | Manage Acme Corp and Globex, and see deal amounts |
| Ben Ortiz | `ben@example.com` | `a long password` | Work in Acme Corp as a member, without amounts |
| Sam Patel | `sam@example.com` | `a long password` | Read every organization as support, in the admin, and change nothing |

| Command | What it does |
| --- | --- |
| `docker compose up -d` | Starts [`docker-compose.yml`](docker-compose.yml): MongoDB on 27018 and Redis on 6380, one above the defaults, so the stack runs beside another project's. Its healthcheck initiates the replica set as `localhost:27018`. `docker compose down -v` deletes the data |
| `npm run seed` | Writes users, organizations, memberships and passwords as trusted code, and everything else through the API as Ann or Ben, so the data passes the same access, hooks and methods as the app ([`demo.ts`](src/infra/seed/demo.ts)). Dates are relative to today. Run twice, it refuses and says how to reset |
| `npm run dev` | [`scripts/dev.mjs`](scripts/dev.mjs): `tsc -b --watch`, the server and the worker under `node --watch`, and Vite, which serves the page and sends the API's paths to port 3000. Ctrl-C stops them all |
| `npm run build` | Builds the servers into `dist/` and the page into `dist/web`, which the server serves at `/` |

Every script loads `.env` when it exists. [`.env.example`](.env.example) has every variable with a working local value:

| Variable | Meaning |
| --- | --- |
| `MONGODB_URL`, `MONGODB_DATABASE` | The store. The database defaults to `crm`. |
| `REDIS_URL` | The session store, and the domain event, webhook and integration queues. |
| `AUTH_TOKEN_SECRETS`, `AUTH_TOKEN_ISSUER`, `AUTH_TOKEN_AUDIENCE` | The session token's signing secrets, newest first, and its claims. Required. |
| `AUTH_SESSION_IDLE_SECONDS`, `AUTH_SESSION_ABSOLUTE_SECONDS` | Session lifetimes. Default 30 minutes idle, 8 hours absolute. |
| `CRM_SUPPORT_USER_IDS` | User ids that act as support, comma separated. |
| `PORT` | Default 3000. |
| `CRM_WEBHOOK_ENDPOINTS` | The worker's webhook endpoints, a JSON list of `{ organizationId, id, url, secrets, events }`. `secrets` are `whsec_` secrets, newest first; `generateSecret()` from `@hexok/webhooks` makes one. Unset: none. |
| `WEBHOOKS_ALLOW_PRIVATE` | `1` lets the worker send to plain http and private addresses, for a receiver on this machine. |

A missing or bad setting fails at startup and names each one. Startup is: start the store, migrate, create indexes, then serve. To migrate as a deploy step instead, run `npx lattice migrate` after `npm run build`. `SIGINT` and `SIGTERM` stop taking requests, let those in flight finish, and close the stores.

The crm is the layout `@latticecms/cli` defaults to: its `package.json` sets `"lattice": { "tenant": "organizationId" }`, so `npx lattice collection <slug>` adds a tenanted collection with no flags.

## The layout

| Folder | What it holds |
| --- | --- |
| [`src/domain`](src/domain) | The collections ([`collections/`](src/domain/collections)), the parent refs activities and tasks share ([`parents.ts`](src/domain/parents.ts)), the domain's errors and events |
| [`src/app`](src/app) | Use cases beyond the generated ones ([`use-cases/`](src/app/use-cases): closing a deal, logging an activity, login), their ports, and the worker's event handlers |
| [`src/infra`](src/infra) | Adapters: the Mongo store, sessions and password hashes, the event publishers, webhook endpoints, migrations, and the demo seed |
| [`src/servers`](src/servers) | The contract ([`rpc/contract.ts`](src/servers/rpc/contract.ts)), the app's wiring ([`app.ts`](src/servers/app.ts)), the HTTP edge, MCP, the `/auth` router, the worker, and the scripts behind `npm run` |
| [`src/web`](src/web) | The React page: the app, and the admin at `/admin`. See [The web app](#the-web-app) |
| [`src/integration`](src/integration) | The integration contract other products subscribe to |
| [`src/test`](src/test) | Test helpers: stores, sessions, an in-memory queue, the HTTP and MCP clients, and the built page |
| [`src/quickstart`](src/quickstart) | Core's quick start, run as a test |

## The web app

A React app on [wouter](https://github.com/molefrog/wouter) routes, [`@shadalaya/react`](https://www.npmjs.com/package/@shadalaya/react) components with the Atalaya palette, Tailwind v4, and `@ts-pf/swr` for data. `npm run build` builds it into `dist/web`; `npm run dev` serves it with Vite.

```
src/web/
  main.tsx, app.css   mounts the app; Tailwind, the theme, and the components the app scans
  app.tsx             every route, in one table, each page loaded lazily
  session.tsx         the session: sessionStorage, the fetch that sends it, and where sign-in returns
  signed-in.tsx       the sign-in redirect, the user's organizations, and useSignedIn()
  api.tsx             useApi(): the typed /rpc client and its swr utils, a fresh cache per organization
  workspace/          the shell's composition: the sections, the team (useTeam, TeamGate), the user menu, search
  pages/              route components, and the sections several routes share, which fetch
  resources/          one home per resource: its types, formatters and components
  ui/                 what knows no resource: the shell, page header, lists, tables, forms, states, dates
```

### The resource UI profile

Where a piece lives, so a reader or an agent can predict it, and find it before building it again.

| Concern | Where and how |
| --- | --- |
| A resource's home | `resources/<resource>/`: `companies`, `contacts`, `deals`, `activities`, `tasks`, `members`. Cross-resource pieces sit beside them: [`parents.ts`](src/web/resources/parents.ts), [`parent-select.tsx`](src/web/resources/parent-select.tsx), [`search.ts`](src/web/resources/search.ts) |
| Names | `<Resource><Role>`, kebab-case files: `deal-stage-badge.tsx` exports `DealStageBadge`. Types in `<resource>.ts`, from the contract; formatters in `<resource>.format.ts` |
| Roles | Inline, Badge, Avatar, Card, Item, columns for a table, Select, Form, Overview (a detail section), Board (deals), Timeline (activities), quick add (tasks). Only the roles a page uses |
| Fetching | Pages, the shared sections in `pages/`, and `workspace/` fetch, and pass data down. A resource component never fetches, except a Select's search hook, which a page builds and passes as a prop |
| Writing | `asResult(rpc.<resource>.<op>(input))`, then [`useAfterWrite`](src/web/ui/after-write.ts), the one path after a write: a toast, the reads made fresh, lists on screen refreshed and lists off screen reset. A cursor list is reached only through it, never a matcher. [`useRowActions`](src/web/ui/row-actions.ts) adds a row's edit, delete and `NOT_FOUND` |
| Forms | One field list per form, `<resource>Fields`, typed by the create input (`FormField<I>` with the parsers `text`, `number`, `isoDate`, `isoDateTime` and `oneOf`), and `fillCreate` and `fillPatch` from it. The server validates; a `VALIDATION` issue shows at its field |
| People | [`useTeam()`](src/web/workspace/team.tsx): the workspace reads the team once. Only what needs it waits, inside `TeamGate` |
| Parents | An activity or a task on a deal records the deal and its company; on a contact, the contact and its company; on a company, the company ([`parentsOf`](src/web/resources/parents.ts)). So a company's timeline and tasks are one filter, with no join |
| States | Every data-bound role has its loading skeleton, its empty state, and an error with a retry |
| Primitives | `@shadalaya/react` only; `ui/` wraps what every resource reuses |

### A resource, end to end

Companies are the pattern the other resources copy.

```
src/web/
  resources/companies/
    company.ts                   Company, CompanyRef and the inputs, from the contract's types
    company.format.ts            the count ("12 companies"), and the website from the domain
    company-sorts.ts             the sorts a list offers, and the one it starts with
    company-inline.tsx           CompanyInline: the name, linking to the company
    company-columns.tsx          companyColumns: what any table of companies shows
    company-overview.tsx         CompanyOverview, a detail section, and its skeleton
    company-form.tsx             CompanyForm: create, or edit when given a company
    company-form.values.ts       the form's fields, and its create input and patch
    company-search.ts            useCompanySearch: what CompanySelect and search read
    company-select.tsx           CompanySelect: pick a company, searched on the server
  pages/
    companies-page.tsx           /companies: count, search, sort, pages, New in a sheet
    company-page.tsx             /companies/:id: overview, contacts, deals, tasks, activity
```

A new resource copies these under its own name, adds its section to [`workspace/sections.tsx`](src/web/workspace/sections.tsx), and its routes to [`app.tsx`](src/web/app.tsx), each page lazy inside `LazyPage` with its skeleton. What it reuses from `ui/`:

| Piece | What it does |
| --- | --- |
| `PageHeader` | The page's h1, which takes focus when the page opens, its actions, and its place in the top bar's breadcrumb |
| `useListParams`, `SearchBox`, `SortSelect`, `useUrlOption`, `useNewSheet` | A list's search, sort and filters in the URL; a create sheet open while the URL says `?new=1` |
| `useCursorPages`, `CursorTable`, `LoadMore` | A `find` a page at a time, and its table: skeleton, retry, empty state, rows, and Load more with focus on the first new row |
| `useAfterWrite`, `useRowActions` | What follows a write; a row's edit, delete and `NOT_FOUND` |
| `Section`, `DataTable`, `DetailList` | A titled part of a page; rows by columns; a detail section's labels and values |
| `useFormSubmit`, `FormSheet`, `TextField`, `TextAreaField`, `SelectField` | A form's submit, with each `VALIDATION` issue at its field, in a sheet that stays open while it sends |
| `FormField`, the parsers, `fillCreate`, `fillPatch` | A typed field list, and the create and the patch from it: trimmed, an empty optional field left out of a create and `null` in a patch, only what changed |
| `ConfirmAction`, `ConfirmDelete` | Ask before acting, open until the action settles, with a refusal in words |
| `SearchSelect`, `Search<T>` | Pick one of a long list, searched on the server as the user types; only the current query's results show |
| `EmptyState`, `ErrorState`, `LazyPage`, the page skeletons | The states, and a lazy page's |
| `format.ts`, `RelativeTime`, `useNow` | Money, days, date-times, day groups, `datetime-local` and back, the month's start; "3 days ago", kept current by one shared clock |

### How the app behaves

| Topic | What it does |
| --- | --- |
| Pages | Each page is a chunk of its own, loaded when it first opens, with a skeleton of its shape meanwhile; a chunk that fails to load offers a reload. Any route but `/sign-in` needs a session, and returns there after sign-in. Support lands on `/admin` |
| Data | [`api.tsx`](src/web/api.tsx) builds `createClient<typeof contract>` on a `FetchLink`, typed by a type-only import, and `createSwr` over it. Each organization gets a fresh cache, and a switch remounts every page. A refusal such as `NOT_FOUND` is not retried |
| Populated refs | A read names its `populate` list in the call, which types the related document in: `swr.contacts.find({ ...input, populate: ['companyId'] })`. One the caller may not read arrives as `{ id }`: `isReadableCompany` and its kin tell them apart |
| Masked fields | A member does not read a deal's amount: `DealAmount` says Withheld. What a page offers follows `readsAmounts(me)`; a member's edit leaves the amount out |
| Relations | A deal's contacts are a `many()`: the page reads every link, changes the list, and sends it whole to `deals.contacts.set` |
| Board | `/deals` is the pipeline board, `?view=table` the table. A deal moves by drag and drop, or by its card's menu, an equal path for the keyboard; a move is announced in a live region. Won and lost are counts under the board |
| Activity | A timeline per company, contact and deal, grouped by day, with a composer folded to one line. Only an activity's author is offered Edit and Delete; the access filter refuses anyone else |
| Tasks | `/tasks` reads the open tasks in one sort, `['dueDate', 'createdAt']`, undated last ([0037](../../docs/decisions/0037-an-optional-field-sorts-with-missing-values-last.md)), and groups them by due date. A checkbox shows done at once from its list's own state, sends it, then the lists read again, focus moves on, and a toast offers Undo. Records have a Tasks section with a quick add |
| Home | `/`: my tasks due, my open deals, the pipeline in counts with this month's wins and losses, and recent activity. Each section reads on its own, so a failed read leaves the rest |
| Team | `/team` lists the members and their roles from `useTeam()`. Roles are written only by trusted code |
| Search | ⌘K or Ctrl+K, or Search… in the top bar, opens a palette over companies, contacts and deals, five of each, by name or title. With nothing typed it offers the sections and the create sheets. Its code loads on first open |
| Styles | `app.css` scans the app's sources and only the shadalaya components it imports; `app-css.test.ts` fails until a new one is listed |
| Server code | The page imports the contract by type only, and [`servers/http/headers.ts`](src/servers/http/headers.ts), which holds a header's name. `bundle.test.ts` checks that no server code reaches it |

The server serves `index.html` for every GET that is not an API path, so a reload on a deep link renders, and caches the hashed files under `/assets/` for good.

### The admin

[`pages/admin-page.tsx`](src/web/pages/admin-page.tsx) mounts `@latticecms/admin`'s `<Admin>` at `/admin`, lazily, with the session's fetch, so the admin and its stylesheet load only when it first opens. Its header links back to the app, and has the organization switcher and Sign out. A support user gets the admin alone.

## Events and the worker

```
HTTP process                 Redis                         worker process
deals.close ──publish──▶  crm:domain: deal.closed  ──┬▶  process deal.closed (crm:deals.send-closed-webhook)
                                                      │    │  reads the deal inside the event's organization
                                                      │    ▼
                          crm:webhooks: webhooks   ◀──┼── @hexok/webhooks sender ──POST──▶ the organization's endpoints
                                                      │
                                                      └▶  process deal.closed (crm:deals.publish-closed)
                                                           │  reads the deal inside the event's organization
                                                           ▼
                          integration: crm.deals   ◀──── IntegrationPublisher(CrmDeals) ──▶ the company's other products
```

- The HTTP process publishes every domain event to the queue, on a topic named by its token: Lattice's `deals.created` and the rest, and `deal.closed` from `deals.close`. It only publishes.
- The worker subscribes each handler in its own consumer group, `crm:<handler token>`, so each handler gets every event. A handler that throws is retried, up to 10 deliveries, then given up. A payload the event schema rejects is logged and dropped.
- Handlers are system code: they read and write through repos with `tenancy.scope(C, event.tenantId)`, never an actor's access. `deal.closed` carries `tenantId` for that.
- `SIGINT` and `SIGTERM` stop the worker taking events, wait for the handlers in flight, stop the webhook sender, then close the queues and the store.
- Each handled event is one OpenTelemetry consumer span per handler, `process deal.closed`, and the handler's store calls are its children.

### The integration contract

The crm publishes one contract for the company's other products, [`src/integration/deals.ts`](src/integration/deals.ts), through `@hexok/integration-events`. It imports nothing from the crm, so it can be published as a package or copied.

- `CrmDeals` is the contract `crm`, with one topic, `crm.deals`, holding `DealClosedV1` (`deal.closed`, version 1).
- When a deal closes, the worker maps it field by field ([`deal-closed-integration.ts`](src/app/event-handlers/deal-closed-integration.ts)) and publishes it on the Redis queue with the shared prefix `integration:`, as a CloudEvents envelope:

```json
{
  "specversion": "1.0",
  "id": "deal.closed:<dealId>",
  "source": "crm",
  "type": "deal.closed",
  "version": 1,
  "time": "2026-11-22T00:00:00.000Z",
  "subject": "<dealId>",
  "data": { "dealId": "…", "organizationId": "…", "companyId": "…", "outcome": "won", "amount": 4242, "closedAt": "2026-11-22T00:00:00.000Z" }
}
```

- It carries `amount`: an internal contract between the company's products, not a customer one.
- The domain event is never published to other products; only this mapping is. A field added to Deals changes no contract until it is added there.
- `id` is the same for a redelivery, so a consumer dedupes on it. A deal closes once.
- A consumer subscribes with `new IntegrationSubscriber(CrmDeals, { queue, service: '<its name>' })` on a RedisQueue with the prefix `integration:`.
- A breaking change is `DealClosedV2` with a downgrade to v1; the contract file says where it goes.

### Webhooks

When a deal closes, its organization's endpoints that list `deal.closed` get, signed per [Standard Webhooks](https://www.standardwebhooks.com/):

```json
{
  "type": "deal.closed",
  "timestamp": "2026-11-22T00:00:00.000Z",
  "data": { "dealId": "…", "companyId": "…", "title": "Big one", "outcome": "won", "closedAt": "2026-11-22T00:00:00.000Z" }
}
```

- The payload is its own schema, mapped field by field from the deal ([`webhook-events.ts`](src/domain/events/webhook-events.ts)), never the deal itself. A field added to Deals reaches no customer until it is added there, and a test asserts the exact keys.
- No `amount`: inside the crm only managers see it, and an endpoint is not an actor whose role can be checked.
- A failed send is retried on @hexok/webhooks' schedule, with the same `webhook-id`, which a receiver dedupes on.

## Calling it

- `POST /auth/login` with `{ "input": { "email", "password" } }` returns `{ token, userId }`.
- `POST /auth/logout` with the token ends its session.
- `POST /auth/organizations` with the token and `{ "input": {} }` returns the user's organizations, `[{ id, name }]` by name, for an organization switcher. It needs no organization header. Support gets none.
- `POST /rpc/<collection>/<operation>` is the Lattice API. Send `Authorization: Bearer <token>` and `x-organization-id: <organization>`.
- `/mcp` serves the same API as MCP tools. See [MCP](#mcp).
- `GET /openapi.json` is the API's OpenAPI 3.1 document, and `GET /catalog.json` its ts-pf catalog, for a signed-in user. See [OpenAPI and other clients](#openapi-and-other-clients).
- Any other `GET` serves the web page, whose routes include the admin at `/admin`. See [The admin](#the-admin).
- `GET /health` answers `{ ok: true }`.

With the server from [Run it](#run-it):

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"input":{"email":"ann@example.com","password":"a long password"}}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).output.token')
ORG=$(curl -s localhost:3000/auth/organizations -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"input":{}}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).output[0].id')
H=(-H "authorization: Bearer $TOKEN" -H "x-organization-id: $ORG" -H 'content-type: application/json')

curl -s localhost:3000/rpc/companies/create "${H[@]}" -d '{"input":{"name":"Acme"}}'
curl -s localhost:3000/rpc/deals/create "${H[@]}" -d '{"input":{"title":"Big one","companyId":"<the company id>","amount":4242}}'
curl -s localhost:3000/rpc/deals/close "${H[@]}" -d '{"input":{"id":"<the deal id>","outcome":"won"}}'
curl -s localhost:3000/rpc/deals/find "${H[@]}" -d '{"input":{"populate":["companyId"]}}'
curl -s localhost:3000/openapi.json -H "authorization: Bearer $TOKEN"
```

Each answer is `{ "ok": true, "output": … }` or `{ "ok": false, "error": { "code", "message" } }`. A closed deal no longer changes: `deals/update` answers it `NOT_FOUND`, as it does an archived deal, and a second `deals/close` is `AlreadyClosed`. Closing the deal publishes `deal.closed`: the worker publishes it on `integration:crm.deals`, which `docker compose exec redis redis-cli XRANGE integration:crm.deals - +` shows, and sends a webhook to any endpoint `CRM_WEBHOOK_ENDPOINTS` lists for that organization's id.

To add a user by hand, `npm run dev:user -- <userId> <name> <email> <password> <organization> [member|manager]` sets a user's password (12 characters or more), creates the organization with that name if there is none, adds the membership under that name with that role (default `member`), and prints a token. An existing membership keeps its name and role. `npm run dev:session -- <userId> <name> <organization> [member|manager]` prints a token without a password. An organization's id is a UUID; `POST /auth/organizations` gives it. Both are for local development. There is no signup and no password reset.

## MCP

`/mcp` is an MCP server over Streamable HTTP, through `@ts-pf/mcp` and the MCP SDK ([`mcp-edge.ts`](src/servers/http/mcp-edge.ts)). It is stateless: each POST is answered on its own, and it serves clients of both the 2026-07-28 protocol and the 2025 one.

- Every procedure at `/rpc` that a caller may use is a tool named by its path: `deals.find` is `deals_find`. Memberships' and organizations' create, update and delete are left out, since no access rule allows them. The `/auth` router is not a tool, so a model cannot log in.
- A tool call runs in process through the same router as `/rpc`: the same access rules, tenancy, masking, errors and spans. A member's `deals_find` has no `amount`, and a `where` on it is `VALIDATION`.
- Lattice describes each generated tool and sets its annotations: reads are `readOnlyHint: true`, `delete` is `destructiveHint: true`, and `create` and `update` are neither. `deals.close` is the crm's own, so it describes itself with `summary` and `effect` on its use case, [`close-deal.ts`](src/app/use-cases/deals/close-deal.ts).

An MCP client authenticates as `/rpc` does: with a session token and an organization header. There is no OAuth sign-in. Get a token from `POST /auth/login` (or `npm run dev:user`), then configure the client with both headers. In Claude Code:

```bash
claude mcp add --transport http crm http://localhost:3000/mcp \
  --header "Authorization: Bearer $TOKEN" \
  --header "x-organization-id: $ORG"
```

- A missing, bad or ended session is a `401` with a `WWW-Authenticate: Bearer error="invalid_token"` challenge, before any MCP message is read. The client needs a new token.
- The organization is checked on every tool call, as on `/rpc`. A call with no header, or for an organization the user is not a member of, is a `FORBIDDEN` tool error.
- A session ends after 30 minutes idle and 8 hours in all, by default, so a long-lived client needs a fresh token.

## OpenAPI and other clients

`GET /openapi.json` with `Authorization: Bearer <token>` (any signed-in user; no organization needed), or `npm run openapi -w @latticecms/example-crm` to write `openapi.json`, gives the API as OpenAPI 3.1 with ts-pf's `codegen` profile, for generators in other languages (openapi-generator, Kiota, swagger_parser). Every path is `POST /rpc/...` with `{ "input": … }`; generate the models and write the call layer, as ts-pf's guide to other languages says.

- Operations carry Lattice's summaries. A populated read (`deals.get`, `deals.find`, `contacts.get`, `contacts.find`) has `x-ts-pf-expand`: its `companyId` is an id, or the company when `populate` names it.
- `amount` is optional, with "Withheld when the caller may not read it.", and its `where` entry says a caller who may not read it is refused.
- Only the `/rpc` contract is in it: no `/auth` route, and no credentials or login attempts.
- It says which fields are masked, so it is not public: without a live session the answer is the `401` `/rpc` sends.

A TypeScript client in another repo uses `@ts-pf/codegen` instead: `emit(catalog(contract))` prints a `contract.d.ts`, and `createClient<Contract>(new FetchLink(…))` is typed per call, `populate` included, with no casts. [`codegen.test.ts`](src/servers/rpc/codegen.test.ts) is that client, against a committed [`contract.d.ts`](src/test/client/contract.d.ts); when the contract changes, it fails until `vitest -u` rewrites the file.

## The HTTP edge

[`src/servers/http`](src/servers/http) is the server, one concern per file:

| File | What it owns |
| --- | --- |
| [`handler.ts`](src/servers/http/handler.ts) | The routes, in order: `/health`, the API's documents, `/mcp`, `/rpc`, `/auth`, then the web page for any other GET |
| [`api-paths.ts`](src/servers/http/api-paths.ts) | The paths the server answers itself. The routes and Vite's dev proxy both read it |
| [`caller.ts`](src/servers/http/caller.ts) | Who is calling: the session, the actor, and the refusals every edge shares |
| [`mcp-edge.ts`](src/servers/http/mcp-edge.ts) | `/mcp`: the API as MCP tools |
| [`documents.ts`](src/servers/http/documents.ts) | `/openapi.json` and `/catalog.json`, for signed-in users |
| [`page.ts`](src/servers/http/page.ts) | The built web page: `index.html` for client routes, and the hashed files under `/assets/` |
| [`server.ts`](src/servers/http/server.ts), [`main.ts`](src/servers/http/main.ts) | Starting the store, migrations and indexes, then serving; and the process that reads `.env` |

## How a request is authenticated

The edge builds the actor before Lattice sees it ([`caller.ts`](src/servers/http/caller.ts)), the same way for `/rpc` and `/mcp`:

1. The bearer token must name a live session. The session holds only the user id.
2. A user listed in `CRM_SUPPORT_USER_IDS` acts as support: every call reads across organizations and changes nothing, and each is logged.
3. Anyone else must be a member of the organization `x-organization-id` names, checked against the `memberships` collection on every request. Switching organizations needs no new session, and a revoked membership stops the next request. The membership's role, `member` or `manager`, goes on the actor, so a changed role takes effect on the next request too.

## Roles and deal amounts

A membership has a `name`, the member's display name in that organization, and a role: `member` (the default) or `manager`. A member reads every membership of its organization, its team, so a team list or an owner picker needs no join. Support reads them all. A deal's `amount` is maskable, and the contract's `fields` rule lets managers and support read it.

- A member sees every deal of the organization without its `amount`, on reads, writes and `deals.close`. A `where` or `sort` on `amount` is `VALIDATION`.
- A manager and support see amounts, and a manager filters and sorts by them.
- A member may still set an amount on create; the response leaves it out. An update that names `amount` is `VALIDATION`, since a member cannot see what it would overwrite.

| Case | Answer |
| --- | --- |
| No token, a bad or expired one, or an ended session | `401 UNAUTHORIZED`, one body for all (on `/mcp`, a `401` bearer challenge) |
| No organization header, not a member, or no such organization | `403 FORBIDDEN`, one body for all (on `/mcp`, a `FORBIDDEN` tool error) |
| A wrong password, an unknown email, or a locked email at login | `401 UNAUTHORIZED`, one body for all |

The reason is logged, never sent. Logs carry no password and no email; a login refusal names a hash of the email instead.

## Activities and tasks

An activity records what happened: a note, call, email or meeting on a company, a contact or a deal ([`activities.ts`](src/domain/collections/activities.ts)). A task is what to do next, with an optional due date and assignee ([`tasks.ts`](src/domain/collections/tasks.ts)). Both are each organization's own, and any member reads them.

- An activity is created only with `activities.log`, a method, not the generated create: its author comes from the actor, never the client ([`log-activity.ts`](src/app/use-cases/activities/log-activity.ts)). `authorId` is not in log's input, so a client cannot name one, and one it sends is dropped. Activities have no `create` access, so `activities.create` is `FORBIDDEN`, and MCP leaves it out. log publishes `activities.created` as the generated create would, by constructing the event from the collection.
- Only the author updates or deletes an activity. That is an access filter on `authorId`, so another member's activity is `NOT_FOUND`. Any member writes tasks.
- Each names a company, a contact or a deal: one rule, `.refine(hasParent, parentRequired)`, shared with the three refs in [`parents.ts`](src/domain/parents.ts). A create without one, or an update that clears the last one, is `VALIDATION` at `companyId`.
- Deleting a company or a contact deletes its activities and tasks (`onDelete: 'cascade'`). A deal's ref restricts: `deals.delete` archives, so an archived deal keeps its history.
- A task's `dueDate` is optional: `find` filters on it (`dueDate: { lte: … }`) and sorts by it, with undated tasks last ([0037](../../docs/decisions/0037-an-optional-field-sorts-with-missing-values-last.md)).

## Passwords and their limits

- Passwords are hashed with scrypt (N = 2^15, r = 8, p = 3) and a random salt. The parameters are stored with each hash, so they can be raised; a login under older ones rehashes.
- An unknown email costs the same hash as a known one.
- Ten failed logins for one email lock it for the rest of a 15-minute window, whether or not the email has an account. A success resets the count.
- The count has no atomic increment, so concurrent failures can overshoot by a few. Anyone can lock an email for 15 minutes by failing on purpose. Per-IP limits belong in front of the app and are not built.
- Hashes and failed attempts live in the `credentials` and `login_attempts` store collections. Lattice never registers them, so no router, MCP tool or API doc can reach them. A Lattice collection must never use those slugs; a test guards it.

## Tests

`npm test -w @latticecms/example-crm` runs every test on `MemoryStore` and on MongoDB, through mongodb-memory-server. Sessions run in memory with real signed tokens, and the queues on `MemoryQueue` ([`src/test/memory-queue.ts`](src/test/memory-queue.ts)), an adapter of the `@hexok/queue` port with the delivery rules of RedisQueue, so Redis is not needed. Webhooks go to a real HTTP server on this machine. MCP tests connect the MCP SDK's own client to `/mcp`.

The browser tests run the built page in headless Chromium, through Playwright, against the HTTP server on a port and MongoDB. Install Chromium once with `npx playwright install chromium`. They read `dist/web`, so `npx turbo run test` builds the crm first. Tests that start a server run after the rest and one file at a time ([`vitest.config.ts`](vitest.config.ts)): each start builds every index, and mongod builds only a few at once.

| Test | What it drives |
| --- | --- |
| [`journey.browser.test.ts`](src/web/journey.browser.test.ts) | The README's promise, from the real seed, as Ann, a step per test: Home, a company and its deal, a call on its timeline, a move on the board by keyboard, a close that Home counts, a task added on a contact and completed on Tasks, Globex's companies only, ⌘K to a contact, the admin and back |
| [`app.browser.test.ts`](src/web/app.browser.test.ts) | The sign-in redirect and its return, the organization switch, the admin and back, sign-out, a 401, support, an admin chunk that fails to load |
| [`companies.browser.test.ts`](src/web/companies.browser.test.ts) | The list, search, sort and pages, create with a refused field, edit, delete, a refused delete, the empty and not-found states |
| [`contacts.browser.test.ts`](src/web/contacts.browser.test.ts) | Each contact's company, a company picked by keyboard, a refused email, edit, delete, a contact on a deal |
| [`deals.browser.test.ts`](src/web/deals.browser.test.ts) | Amounts for a manager and Withheld for a member, filters and sorts, a blind amount, closing once from two tabs, archiving, a deal's contacts |
| [`board.browser.test.ts`](src/web/board.browser.test.ts) | Columns and counts, a move by keyboard and by drag and drop, closing from a card, a member's view |
| [`activities.browser.test.ts`](src/web/activities.browser.test.ts) | A call on a deal on its timeline and its company's, a refused body, one's own edit and delete, another's activity, one deleted behind the page |
| [`tasks.browser.test.ts`](src/web/tasks.browser.test.ts) | Groups, Mine and Everyone, creating on a deal and by quick add, done at once while the server is slow, Undo, two quick checks, nothing lost meanwhile, edit and delete |
| [`home.browser.test.ts`](src/web/home.browser.test.ts) | Home as a manager and a member, a task checked there, the counts after a board move, one section's failed read; the team page |
| [`search.browser.test.ts`](src/web/search.browser.test.ts) | The palette by shortcut and button, grouped results, the keyboard to a contact, focus back on Esc, a stale search never shown, New deal |
| [`admin.browser.test.ts`](src/web/admin.browser.test.ts) | The admin: organizations, create, edit and delete, a member's view, a refused delete, a relation tab, a deep link, sign-out |
| [`bundle.test.ts`](src/web/bundle.test.ts) | Gzipped budgets from Vite's manifest: startup, with and without React, each page, the admin; and no server code in the page |

Two tests keep the docs honest. [`readme-quotes.test.ts`](src/readme-quotes.test.ts) checks that every code block whose first line names a file, such as `// examples/crm/src/servers/app.ts`, is that file's text, line for line, allowing only a uniform indent to be removed. It reads the READMEs of core, store-mongo, cli and admin, this one, and every file of core's agent skill. [`quickstart.test.ts`](src/quickstart/quickstart.test.ts) runs core's quick start, which lives in [`src/quickstart`](src/quickstart).
