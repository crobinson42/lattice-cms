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

Open <http://localhost:5173/admin/> and sign in:

| Name | Email | Password | Can |
| --- | --- | --- | --- |
| Ann Lee | `ann@example.com` | `a long password` | Manage Acme Corp and Globex, and see deal amounts |
| Ben Ortiz | `ben@example.com` | `a long password` | Work in Acme Corp as a member, without amounts |
| Sam Patel | `sam@example.com` | `a long password` | Read every organization as support, and change nothing |

- `docker compose up -d` starts [`docker-compose.yml`](docker-compose.yml). Its healthcheck initiates the replica set, with the member `localhost:27017`, so the host connects with `replicaSet=rs0`. `docker compose down -v` deletes the data.
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

## The admin

`npm run build` builds the admin page into `dist/web`, and the server serves it at `/admin`; `npm run dev` serves it with Vite instead. Sign in as a seeded user from [Run it](#run-it). The top bar's select switches organization, and Sign out ends the session. A support user signs in to the admin with no switcher: support acts in no organization.

The page is [`src/web`](src/web): `@latticecms/admin`'s `<Admin>`, mounted the way an app mounts it.

- [`app.tsx`](src/web/app.tsx) signs in through `/auth`, lists the user's organizations for the switcher, and keys `<Admin>` by the picked one, so a switch starts with an empty cache.
- [`session.ts`](src/web/session.ts) keeps the token and the picked organization in `sessionStorage`, for the tab. Its fetch adds `Authorization` and `x-organization-id` to every call, and a 401 signs the user out.
- [`auth.ts`](src/web/auth.ts) is a ts-pf client on `/auth`, typed by `typeof authContract` with a type-only import, so no server code reaches the browser.

The server serves `index.html` for every path under `/admin`, so a reload on a deep link renders, and caches the hashed files under `/admin/assets/` for good.

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

- `POST /auth/login` with `{ "input": { "email", "password" } }` returns `{ token }`.
- `POST /auth/logout` with the token ends its session.
- `POST /auth/organizations` with the token and `{ "input": {} }` returns the user's organizations, `[{ id, name }]` by name, for an organization switcher. It needs no organization header. Support gets none.
- `POST /rpc/<collection>/<operation>` is the Lattice API. Send `Authorization: Bearer <token>` and `x-organization-id: <organization>`.
- `/mcp` serves the same API as MCP tools. See [MCP](#mcp).
- `GET /openapi.json` is the API's OpenAPI 3.1 document, and `GET /catalog.json` its ts-pf catalog, for a signed-in user. See [OpenAPI and other clients](#openapi-and-other-clients).
- `GET /admin` and every path under it serve the admin page. See [The admin](#the-admin).
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

`/mcp` is an MCP server over Streamable HTTP, through `@ts-pf/mcp` and the MCP SDK ([`handler.ts`](src/servers/http/handler.ts)). It is stateless: each POST is answered on its own, and it serves clients of both the 2026-07-28 protocol and the 2025 one.

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

## How a request is authenticated

The edge builds the actor before Lattice sees it ([`handler.ts`](src/servers/http/handler.ts)), the same way for `/rpc` and `/mcp`:

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

[`admin.browser.test.ts`](src/web/admin.browser.test.ts) runs the built admin page in headless Chromium, through Playwright, against the HTTP server on a port and MongoDB. It signs in, switches organization and sees only that organization's deals, creates, edits and deletes a company and a deal, checks that a member sees no amount in the list or the form, deletes a company that still has deals and follows the link to them, sets a deal's contacts on its relation tab, reloads a deep link, and signs out. Install Chromium once with `npx playwright install chromium`. [`bundle.test.ts`](src/web/bundle.test.ts) holds the built page to a gzipped budget, in all and without React. Both read `dist/web`, so `npx turbo run test` builds the crm first. The tests that start a real server on MongoDB, the browser test among them, run after the rest and one file at a time ([`vitest.config.ts`](vitest.config.ts)): each start builds every index, and mongod builds only a few at once, so overlapping starts stall each other.

Two tests keep the docs honest. [`readme-quotes.test.ts`](src/readme-quotes.test.ts) checks that every code block whose first line names a file, such as `// examples/crm/src/servers/app.ts`, is that file's text, line for line, allowing only a uniform indent to be removed. It reads the READMEs of core, store-mongo, cli and admin, this one, and every file of core's agent skill. [`quickstart.test.ts`](src/quickstart/quickstart.test.ts) runs core's quick start, which lives in [`src/quickstart`](src/quickstart).
