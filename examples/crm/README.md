# examples/crm

A CRM on Lattice: companies, contacts, deals, activities and tasks, each organization's own, on MongoDB. It is the example the `@latticecms/core` README quotes, and the app every Lattice change is checked against. It is private and never published.

## Run it

It runs as two processes, the HTTP server and the worker, on MongoDB (a replica set, for transactions) and Redis (sessions and the event queues). You need Node 24 and Docker.

Once, from the repository root, install and build. The crm runs on the built `@latticecms/core` and `@latticecms/store-mongo`:

```bash
npm install
npm run build
```

Then, in `examples/crm`:

```bash
cp .env.example .env    # once: local settings, gitignored
docker compose up -d    # MongoDB 8 as a one-node replica set, and Redis 7
npm run seed            # two organizations, three users and a pipeline
npm run dev             # the server, the worker and Vite, each reloading on change
```

Open <http://localhost:5173/> and sign in. The page serves the app at `/` and the admin at `/admin`; until the app is built, `/` opens the admin.

| Name | Email | Password | Can |
| --- | --- | --- | --- |
| Ann Lee | `ann@example.com` | `a long password` | Manage Acme Corp and Globex, and see deal amounts |
| Ben Ortiz | `ben@example.com` | `a long password` | Work in Acme Corp as a member, without amounts |
| Sam Patel | `sam@example.com` | `a long password` | Read every organization as support, and change nothing |

- `docker compose up -d` starts [`docker-compose.yml`](docker-compose.yml). MongoDB listens on 27018 and Redis on 6380, one above the defaults, so the stack runs beside another project's. Its healthcheck initiates the replica set, with the member `localhost:27018`, so the host connects with `replicaSet=rs0`. `docker compose down -v` deletes the data.
- `npm run seed` writes users, organizations, memberships and passwords as trusted code, and everything else through the API as Ann or Ben, so the data passes the same access, hooks, overrides and methods as the app ([`demo.ts`](src/infra/seed/demo.ts)). Its dates are relative to today. It needs only MongoDB. Run twice, it refuses and says how to reset.
- `npm run dev` ([`scripts/dev.mjs`](scripts/dev.mjs)) runs `tsc -b --watch`, the server and the worker under `node --watch`, and Vite, with each line prefixed by its process. Vite serves the admin and sends `/rpc`, `/auth` and `/catalog.json` to the server on port 3000. Ctrl-C stops them all.

Every script loads `.env` when it exists (`node --env-file-if-exists=.env`). [`.env.example`](.env.example) has every variable with a working local value:

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

The crm is the layout `@latticecms/cli` defaults to. Its `package.json` sets `"lattice": { "tenant": "organizationId" }`, so `npx lattice collection <slug>` adds a tenanted collection with no flags.

A missing or bad setting fails at startup and names each one. Startup is: start the store, migrate, create indexes, then serve. To migrate as a deploy step instead, run `npx lattice migrate` after `npm run build`; it runs the same list from `dist/servers/scripts/migrate.js`. `SIGINT` and `SIGTERM` stop taking requests, let those in flight finish, and close the stores.

## The web app

`npm run build` builds the web app into `dist/web`, and the server serves it at `/`; `npm run dev` serves it with Vite instead. It is a React app on [wouter](https://github.com/molefrog/wouter) routes, [`@shadalaya/react`](https://www.npmjs.com/package/@shadalaya/react) components and Tailwind v4, with data through `@ts-pf/swr`. The admin is one of its routes, at `/admin`. Sign in as a seeded user from [Run it](#run-it).

```
src/web/
  main.tsx          mounts the app, and imports app.css
  app.css           Tailwind, the shadalaya theme, and the components the app scans
  app.tsx           every route, in one table, each page loaded lazily
  session.tsx       the session: sessionStorage, the fetch that sends it, its provider, and where sign-in returns
  signed-in.tsx     the sign-in redirect, the user's organizations, and useSignedIn()
  auth.ts           the /auth client, and the types of its answers
  api.tsx           useApi(): the typed /rpc client and its swr utils
  workspace/        the member's pages in the shell: the sections, the signed-in member and the team (useTeam, TeamGate), the user menu
  pages/            route components, each its default export (sign-in, the dashboard at `/`, companies, contacts, deals as a board and a table, one of each, tasks, the team, and the admin), and the sections several routes share, which fetch: activity, tasks
  resources/        one home per resource, companies, contacts, deals, activities, tasks and members: its type, formatters and components; and the parents rule, which activities and tasks share
  ui/               what knows no resource: the shell, page header, lists, tables, forms, states, dates
```

- Each page is a chunk of its own, loaded when it first opens, so startup does not grow with each resource: `React.lazy` in [`app.tsx`](src/web/app.tsx), inside `LazyPage`. Until a page's code is there, a skeleton of its shape shows, a list's or a detail's. A chunk that fails to load, such as an old hash after a deploy, offers a reload. Sign-in loads at startup: it is the first page a signed-out user sees.
- Any route but `/sign-in` needs a session. Without one, it sends the user to `/sign-in` and back after, to a page of this site only. A signed-in user who opens `/sign-in` goes straight on. `/` is Home, the dashboard.
- [`api.tsx`](src/web/api.tsx) builds the clients once per session and organization: `createClient<typeof contract>` on a `FetchLink`, typed by a type-only import of the contract, and `createSwr` over it. Data comes from `useSWR(swr.companies.get.key({ input: { id } }), swr.companies.get.fetcher())`, typed by the contract. Each organization gets a fresh swr cache, and a switch remounts every page, so none shows another organization's data. A refusal such as `NOT_FOUND` is not retried.
- [`session.tsx`](src/web/session.tsx) keeps the token, the user's id and the picked organization in `sessionStorage`, for the tab. Its fetch adds `Authorization` and `x-organization-id` to every call. A 401 signs the user out, if its session is still the tab's. Sign-out ends the session here at once, and tells the server without waiting for it.
- [`ui/shell.tsx`](src/web/ui/shell.tsx) is the frame of a page: the sidebar of sections, and a top bar with the page's breadcrumb, then what its owner puts there. Each page has its own `PageHeader`: its h1 takes focus when the page opens, and its title, after the pages above it, is the top bar's breadcrumb. The workspace puts the organization switcher and the user menu, which shows the member and links to the admin and sign-out. A page adds its section to the workspace's list.
- Pages fetch, and `resources/` and `ui/` take data as props. `resources/members/` holds `Member`, `displayName` and `initials`, and `MemberAvatar`.
- `app.css` scans the app's sources and only the shadalaya components it imports. A page that imports a new component adds its file name to the list in `app.css`; `app-css.test.ts` fails until it does. The app uses shadalaya's Atalaya palette: `app.css` imports `atalaya.css` after the theme's tokens. The admin's stylesheet brings the neutral tokens again when `/admin` opens, so [`pages/admin-page.tsx`](src/web/pages/admin-page.tsx) imports `atalaya.css` after it, in the same chunk.
- The page imports the contracts by type only, and `servers/http/headers.ts`, which holds only a header's name. `bundle.test.ts` checks that no server code reaches the browser.
- Support acts in no organization, so it lands on `/admin`.

### A resource, end to end

Companies are the pattern the other resources copy. A resource has its own home and its pages; everything else it reuses from `ui/`.

```
src/web/
  resources/companies/
    company.ts                   Company, and its create and update inputs, from the contract's types
    company.format.ts            the count ("12 companies"), and the website from the domain
    company-sorts.ts             the sorts a list offers, and the one it starts with
    company-inline.tsx           CompanyInline: the name, linking to the company
    company-website.tsx          CompanyWebsite: the domain, opening the site
    company-columns.tsx          companyColumns: what any table of companies shows
    company-overview.tsx         CompanyOverview, a detail section, and its skeleton
    company-form.tsx             CompanyForm: create, or edit when given a company
    company-form.values.ts       the form's fields, which are optional, and its create input and patch
  pages/
    companies-page.tsx           /companies: count, search, sort, pages, New in a sheet
    company-page.tsx             /companies/:id: overview, Edit in a sheet, Delete behind a confirmation
```

What a resource reuses, from `ui/`:

| Piece | What it does |
| --- | --- |
| `PageHeader` | The page's h1, which takes focus when the page opens, its actions, and its place in the top bar's breadcrumb |
| `useListParams`, `SearchBox`, `SortSelect` | The list's search and sort in the URL, with a search that waits for a pause |
| `useCursorPages`, `CursorTable` | A `find` a page at a time, and its table: the skeleton, a retry, the empty state, the rows, Load more with focus on the first new row |
| `useAfterWrite` | What follows a write: a toast, the collection's reads made fresh, and every list off screen reset, so none shows a removed row; with `goTo`, the next page reads fresh before it shows |
| `useRowActions` | After a row's own write, for activities and tasks: a `NOT_FOUND` in words with the lists read again, a saved edit that settles once they have, and a delete's refusal in words |
| `Section` | A titled part of a page, such as a company's contacts, with its action |
| `DataTable`, `DataTableSkeleton` | Rows by the resource's columns, named for assistive tech |
| `useFormSubmit`, `TextField`, `FormSheet` | A form's submit, with each `VALIDATION` issue at its field, in a sheet that stays open while it sends |
| `FormField`, `text`, `number`, `isoDate`, `oneOf`, `fillCreate`, `fillPatch` | A resource's field list, typed by the create input: each field's parser has the field's own type, and only a field the input lets be absent may be `optional`. The create and the patch come from it: trimmed, an empty optional field left out of a create and `null` in a patch, and only what changed |
| `DetailList`, `PhoneLink` | A detail section's labels and values, with a dash for a missing one, and its skeleton |
| `ConfirmAction` | A button and a dialog that asks before it acts, such as closing a deal, open until the action settles, with a refusal in words |
| `ConfirmDelete` | Delete behind a confirmation, open until the delete settles, and a refusal in words, for a document others point at and for one on a relation |
| `SearchSelect` | A form field that picks one of a long list, searched on the server as the user types: arrows, Enter and Esc. It shows only the current query's results, cancels a search the user typed past, and says what it found. A resource's Select, such as `CompanySelect`, names its labels and keys, and takes the search, a `Search<T>`, as a prop. `onPick` hands over the whole picked item, for a form that needs more than its key; without a `name` it submits nothing |
| `TextAreaField` | A labelled multi-line field, for an activity's body |
| `dayGroups`, `formatDateTime`, `isoDateTime`, `toLocalInput`, `monthStart` | A timeline's runs by local day (Today, Yesterday, the date); a date-time with its time; a `datetime-local` value as ISO and back; the start of this month, local, as ISO |
| `SelectField`, `useUrlOption` | A short list's select in a form, with `onChange` for a form that changes with it; one option of a list kept in the URL, such as a stage filter |
| `EmptyState`, `ErrorState`, `formatDate`, `formatDay`, `formatRelative`, `formatMoney` | The empty and failed states; date-times, plain dates and money, in whole dollars |
| `RelativeTime`, `useNow` | "3 days ago", with the exact time in its title, kept current by one shared clock a minute |

The members home is the one every resource that names a person uses: `MemberInline` (an avatar and a name, or "Former member" for an id the team no longer holds) and `MemberSelect` (a member, or "Unassigned"). The workspace reads the signed-in member on their own, for the user menu and their role, and the whole team once, every page of it. Pages take both from `useTeam()`, so no page reads members again, and only what needs the team waits for it, inside `TeamGate`, with its own retry.

- **Pages fetch, the resource home draws.** A page reads with `useSWR` or `useCursorPages` over `swr.companies.*` and hands the data to the home's components. A component in a resource home never fetches. A Select is the one exception, and even it takes its search as a prop: `useCompanySearch()` builds it for the pages.
- **A masked field says so.** A member does not read a deal's amount: the contract's field rule withholds it. Every deal has an amount, so one without it was withheld: `DealAmount` shows "Withheld", with why. What a page offers comes from the member's role, `readsAmounts(me)`: the amount sort is not offered to a member, and a read refused as `VALIDATION`, such as a demoted manager's amount sort, reads the role again. A member's edit form leaves the amount out, since a patch naming it is refused. On create they set it blind, and the form tells them they will not see it after saving.
- **A related document comes with the read.** Contacts read their company with `populate: ['companyId']`, one request for a whole page. The literal list in the call types the company in: `useSWR(key, () => swr.contacts.get({ id, populate: ['companyId'] }))`, and `useCursorPages(key, input, (input) => swr.contacts.find({ ...input, populate: ['companyId'] }))`. A company the caller may not read arrives as `{ id }`: `CompanyRef` types both, `isReadableCompany` tells them apart, `CompanyInline` shows it as hidden, and `CompanySelect` keeps its id, so an edit that does not change it sends nothing.
- **Writes go through `rpc` and `asResult`.** `asResult(rpc.companies.create(input))` answers with the created company, or the refusal as an `ApiError` (api.tsx): `error.code` narrows it, and `VALIDATION` carries its issues. After a write, the page calls `useAfterWrite()` with `swr.companies.matcher()`: a toast, the collection's reads revalidated, every list on screen refreshed, and every list off screen reset, so a deleted row never shows when it opens again. A write that leaves the page passes `goTo`, and the next page reads fresh before it shows.
- **One form, two modes.** `CompanyForm` creates without a company and edits with one. It sends what changed only, and `null` for a cleared field. The server validates: the form shows a `VALIDATION` issue at its field, so the rules and their messages live in the collection's schema.
- **The URL holds the list's state.** The search and the sort are in the query, so back, reload and a shared link return to the same list.
- **Every state has a place.** Loading shows the table's or the overview's skeleton. An empty list offers New company, a search with no match offers Clear search, and a failed read offers Try again. A company that is not there says so, with a link back.
- **Refusals in words.** A delete refused with `REFERENCED` says what still points at the company: "Acme still has contacts. Remove them first."
- **Success says so.** A toast confirms a create, an edit or a delete.
- **A relation is a list you replace.** A deal's contacts are its `contacts` relation, a `many()`. The page reads every link (`deals.contacts.list`, oldest first), then those contacts with their companies in one populated `contacts.find` with `id: { in }`. Adding someone, changing a role or removing someone sends the whole new list to `deals.contacts.set`, which replaces the links by diffing: `withContact` and `withoutContact` build it from the current list. One change runs at a time: it is shown at once and undone if refused, and a remove waits for the server, then focus goes to Add contact. The picker does not offer contacts already on the deal. Any `many()` relation in the UI follows this: read all, change the list, set it.
- **Activity, by a rule for its parents.** The company, contact and deal pages each have an Activity section (`pages/activity-section.tsx`): a composer, folded to one line until asked for, over the timeline, newest first, in groups by day. The app logs by a rule (`parentsOf` in `resources/parents.ts`, which tasks share): an activity on a deal records the deal and its company; one on a contact, the contact and its company; one on a company, the company. So a company's timeline is one filter, `companyId: { eq }`, and shows everything that happened around it, with no join and no `or`. The company is the one at logging time: a contact or deal that moves to another company leaves its activities on the old one's timeline, as they happened with that company. On a company's timeline an activity on a deal says "on" the deal and one on a contact "with" them; on a deal's, an activity with a contact says "with" them too. The domain allows any combination, and the seed follows the rule. Only an activity's author is offered Edit and Delete; the access filter refuses anyone else as `NOT_FOUND`, which the page says in words before it reads the timeline again through `useAfterWrite`, the one path that reaches a cursor list. `occurredAt` is a `datetime-local` in the browser's time zone, sent as ISO (`isoDateTime`, `toLocalInput`).
- **Home, a section at a time.** `/` is the signed-in member's dashboard ([`pages/home-page.tsx`](src/web/pages/home-page.tsx)), in two columns on a wide screen. My tasks lists my open tasks due today or before, through `useTaskPages` and `TaskList`, checkable as on the Tasks page. My deals lists the open deals I own, by expected close date with the undated last ([0037](../../docs/decisions/0037-an-optional-field-sorts-with-missing-values-last.md)), as `DealItem`s: an amount a member does not read says Withheld. Pipeline counts the open deals in each stage, and those won and lost since the start of this month in the browser's time zone (`monthStart`, a `closedAt: { gte }`), each count a link: counts only, no sums. Recent activity is the organization's last ten, each saying what it is "on", "with" and "for". Each section reads on its own, with its own skeleton, empty state and retry, so a failed read leaves the rest of the page. Every read is one the app's writes already refresh: a task checked there, or a deal moved on the board, shows in the counts.
- **The team, as read.** `/team` lists the organization's members from `useTeam()`, which the workspace has already read: each member, their role, and "You" beside the signed-in one ([`member-columns.tsx`](src/web/resources/members/member-columns.tsx)). Memberships are written only by trusted code, so the page has nothing to edit, and says that roles are managed by an administrator.
- **Tasks, sorted on an optional field.** `/tasks` shows the signed-in member's open tasks, or everyone's with `?who=everyone`, in one read sorted `['dueDate', 'createdAt']`. A task may have no due date, and core sorts an optional field with missing values last, ascending too ([0037](../../docs/decisions/0037-an-optional-field-sorts-with-missing-values-last.md)), so the undated come after the rest without a second list, and Load more pages across them. The page splits the rows into Overdue, Today, This week, Later and No due date (`dueGroups` in `resources/tasks/task.format.ts`, from today in the browser's time zone). The done ones are under them, behind a button, recent first. New task picks what it is on with `ParentSelect`: a company, a contact or a deal, the last two with their company, by the same rule as activities. The company, contact and deal pages each have a Tasks section (`pages/task-section.tsx`): a quick add, for the signed-in member, the open tasks by due date, and the done ones behind "Show done (n)".
- **Done in one click.** A task's checkbox shows the change at once from its list's own state, a map of the tasks on their way, and sends `tasks.update({ id, done })`. The SWR cache is untouched until the server answers, so a read, a Load more, a quick add or an edit made meanwhile is never lost, and two quick checks are two writes that both stick. Then the lists read again through `useAfterWrite`: the task leaves for Done (or back), focus goes to the next row's box, or the one before, a status region says "Marked … done", and a toast offers Undo, which sends the change back the same way. A refusal clears the box and says why. The sidebar's Tasks link carries my overdue count in its name.
- **The board has two equal paths.** `/deals` opens on the pipeline board, a column per open stage, each a labelled list with its own count and its own pages; `?view=table` is the table. A deal moves by drag and drop, or by its card's menu ("Move to", then a stage), which the keyboard reaches like any button. Both call `deals.update` with the stage, show the card as moving, and announce the move in a polite live region; a refusal is a toast, and the card stays. A card that is moving cannot move again, and it shows as moving until it is in its new column; after a move by the keyboard, focus is on the card's menu in its new column. Closing from a card opens the same dialog as the deal's page (`closeDialog` and `useDealActions`, in `resources/deals/deal-actions.ts`, beside the resource's other API helpers), and Cancel returns focus to the card's menu. Won and lost deals are not columns: the line under the board counts them, and links to the table filtered by stage.

A new resource copies these files under its own name, adds its section to [`workspace/workspace.tsx`](src/web/workspace/workspace.tsx), and adds its routes to [`app.tsx`](src/web/app.tsx), each page lazy inside `LazyPage` with `ListPageSkeleton` or `DetailPageSkeleton`.

The server serves `index.html` for every GET that is not an API path, so a reload on a deep link such as `/admin/deals` renders, and caches the hashed files under `/assets/` for good.

### The admin

[`pages/admin-page.tsx`](src/web/pages/admin-page.tsx) mounts `@latticecms/admin`'s `<Admin>` at `/admin`, the way an app mounts it: lazily, like every page, so the admin and its stylesheet load only when `/admin` first opens. It uses the session's fetch, and a switch remounts it with an empty cache, as it does every page. A chunk that fails to load, such as an old hash after a deploy, shows an error with a reload. Its header has a link back to the app, the organization switcher and Sign out. A support user gets the admin with no switcher and no link back.

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
- A task's `dueDate` is optional, so `find` filters on it (`dueDate: { lte: … }`) but cannot sort by it.

## Passwords and their limits

- Passwords are hashed with scrypt (N = 2^15, r = 8, p = 3) and a random salt. The parameters are stored with each hash, so they can be raised; a login under older ones rehashes.
- An unknown email costs the same hash as a known one.
- Ten failed logins for one email lock it for the rest of a 15-minute window, whether or not the email has an account. A success resets the count.
- The count has no atomic increment, so concurrent failures can overshoot by a few. Anyone can lock an email for 15 minutes by failing on purpose. Per-IP limits belong in front of the app and are not built.
- Hashes and failed attempts live in the `credentials` and `login_attempts` store collections. Lattice never registers them, so no router, MCP tool or API doc can reach them. A Lattice collection must never use those slugs; a test guards it.

## Tests

`npm test -w @latticecms/example-crm` runs every test on `MemoryStore` and on MongoDB, through mongodb-memory-server. Sessions run in memory with real signed tokens, and the queues on `MemoryQueue` ([`src/test/memory-queue.ts`](src/test/memory-queue.ts)), an adapter of the `@hexok/queue` port with the same delivery rules as RedisQueue. Redis is not needed. Webhooks are sent to a real HTTP server on this machine. MCP tests connect the MCP SDK's own client to `/mcp`.

[`admin.browser.test.ts`](src/web/admin.browser.test.ts) runs the built admin page in headless Chromium, through Playwright, against the HTTP server on a port and MongoDB. It signs in, switches organization and sees only that organization's deals, creates, edits and deletes a company and a deal, checks that a member sees no amount in the list or the form, deletes a company that still has deals and follows the link to them, sets a deal's contacts on its relation tab, reloads a deep link, and signs out. Install Chromium once with `npx playwright install chromium`. [`app.browser.test.ts`](src/web/app.browser.test.ts) runs the app the same way: the sign-in redirect and its return, the organization switch, the admin through the user menu and back, sign-out, a 401, support, and an admin chunk that fails to load. [`companies.browser.test.ts`](src/web/companies.browser.test.ts) drives Companies: the list, search, sort and pages, create with a refused field, edit, delete, a refused delete, and the empty and not-found states. [`contacts.browser.test.ts`](src/web/contacts.browser.test.ts) drives Contacts: the list with each contact's company, a company picked by keyboard, a refused email, edit, delete, a contact on a deal, and a company's own contacts. [`deals.browser.test.ts`](src/web/deals.browser.test.ts) drives Deals as a manager and as a member: amounts and withheld amounts, the stage filter and the sorts each may use, a blind amount on create with an owner, an edit without the amount, closing once from two tabs, archiving, a company's own deals, and a deal's contacts added, re-roled and removed, each change sending the full list to `set`. [`home.browser.test.ts`](src/web/home.browser.test.ts) checks the dashboard as a manager and as a member: tasks due, deals with their amounts or Withheld, the pipeline's counts with this month's win and not last month's, the latest activity, a task checked there, the counts after a move on the board, and one section's failed read beside the rest; and the team page's rows, roles and "You". [`tasks.browser.test.ts`](src/web/tasks.browser.test.ts) checks the Tasks page's groups, with the undated last, and Mine and Everyone; creates a task on a deal from the page, and from a company's quick add; marks one done at once while the server is slow, then sees it move to Done with focus on the next box, the sidebar's overdue count with it, and Undo bring it back; keeps two quick checks; loses no Load more, quick add or edit made while a check is on its way; and edits one into another group, then deletes it. [`activities.browser.test.ts`](src/web/activities.browser.test.ts) logs a call on a deal and finds it on the deal's timeline and its company's, grouped by day, refuses an empty body at its field, edits and deletes one's own, offers neither on another member's, and drops an activity deleted behind the page when it is acted on. [`board.browser.test.ts`](src/web/board.browser.test.ts) drives the board: its columns and counts, a move through a card's menu by keyboard, a move by drag and drop (Chromium's native drag events work headless), closing from a card, and a member's withheld amounts and overdue dates. [`bundle.test.ts`](src/web/bundle.test.ts) reads Vite's manifest and holds the built page to gzipped budgets: what loads at startup, in all and without React, what opening each page adds, and what opening the admin adds, which must hold the admin and its stylesheet. It also checks that no server code reaches the page. They read `dist/web`, so `npx turbo run test` builds the crm first. The tests that start a real server on MongoDB, the browser tests among them, run after the rest and one file at a time ([`vitest.config.ts`](vitest.config.ts)): each start builds every index, and mongod builds only a few at once, so overlapping starts stall each other.

Two tests keep the docs honest. [`readme-quotes.test.ts`](src/readme-quotes.test.ts) checks that every code block whose first line names a file, such as `// examples/crm/src/servers/app.ts`, is that file's text, line for line, allowing only a uniform indent to be removed. It reads the READMEs of core, store-mongo, cli and admin, this one, and every file of core's agent skill. [`quickstart.test.ts`](src/quickstart/quickstart.test.ts) runs core's quick start, which lives in [`src/quickstart`](src/quickstart).
