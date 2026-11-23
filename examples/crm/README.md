# examples/crm

A CRM on Lattice: companies, contacts and deals, each organization's own, on MongoDB. It is the example the `@latticecms/core` README quotes, and the app every Lattice change is checked against. It is private and never published.

## Run it

It runs as two processes: the HTTP server and the worker. Both need MongoDB, as a replica set for transactions, and Redis, for sessions and the event queues. You need Node 24 and Docker, or MongoDB 8 and Redis 7 installed another way.

Start MongoDB as a one-node replica set, and Redis:

```bash
docker run -d --name crm-mongo -p 27017:27017 mongo:8 --replSet rs0
docker exec crm-mongo mongosh --quiet --eval "rs.initiate()"   # once mongod is up; repeat if it is not yet
docker run -d --name crm-redis -p 6379:6379 redis:7
```

Install and build from the repository root. The crm runs on the built `@latticecms/core` and `@latticecms/store-mongo`, so build them all:

```bash
npm install
npm run build
```

Set the configuration, in each terminal you run a process from. `directConnection=true` talks to the container directly, since the replica set names its member by the container's host name:

```bash
export MONGODB_URL='mongodb://localhost:27017/?directConnection=true'
export REDIS_URL=redis://localhost:6379
export AUTH_TOKEN_SECRETS=<one secret, the same in every terminal>   # make one: node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
export AUTH_TOKEN_ISSUER=crm AUTH_TOKEN_AUDIENCE=crm
```

Create a user with a password and a membership, then start the server and, in a second terminal, the worker:

```bash
npm run dev:user -w @latticecms/example-crm -- ann ann@example.com 'a long password' org-a manager
npm start -w @latticecms/example-crm
npm run worker -w @latticecms/example-crm
```

`dev:user` prints a session token. The server logs `http listening`, and the worker `worker subscribed` with its two handlers. Then [call it](#calling-it).

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

A missing or bad setting fails at startup and names each one. Startup is: start the store, migrate, create indexes, then serve. `SIGINT` and `SIGTERM` stop taking requests, let those in flight finish, and close the stores.

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
  "data": { "dealId": "…", "organizationId": "org-a", "companyId": "…", "outcome": "won", "amount": 4242, "closedAt": "2026-11-22T00:00:00.000Z" }
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
- `POST /rpc/<collection>/<operation>` is the Lattice API. Send `Authorization: Bearer <token>` and `x-organization-id: <organization>`.
- `/mcp` serves the same API as MCP tools. See [MCP](#mcp).
- `GET /openapi.json` is the API's OpenAPI 3.1 document, for a signed-in user. See [OpenAPI and other clients](#openapi-and-other-clients).
- `GET /health` answers `{ ok: true }`.

With the server from [Run it](#run-it):

```bash
TOKEN=$(curl -s localhost:3000/auth/login -H 'content-type: application/json' \
  -d '{"input":{"email":"ann@example.com","password":"a long password"}}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).output.token')
H=(-H "authorization: Bearer $TOKEN" -H 'x-organization-id: org-a' -H 'content-type: application/json')

curl -s localhost:3000/rpc/companies/create "${H[@]}" -d '{"input":{"name":"Acme"}}'
curl -s localhost:3000/rpc/deals/create "${H[@]}" -d '{"input":{"title":"Big one","companyId":"<the company id>","amount":4242}}'
curl -s localhost:3000/rpc/deals/close "${H[@]}" -d '{"input":{"id":"<the deal id>","outcome":"won"}}'
curl -s localhost:3000/rpc/deals/find "${H[@]}" -d '{"input":{"populate":["companyId"]}}'
curl -s localhost:3000/openapi.json -H "authorization: Bearer $TOKEN"
```

Each answer is `{ "ok": true, "output": … }` or `{ "ok": false, "error": { "code", "message" } }`. Closing the deal publishes `deal.closed`: the worker publishes it on `integration:crm.deals`, which `docker exec crm-redis redis-cli XRANGE integration:crm.deals - +` shows, and sends a webhook to any endpoint `CRM_WEBHOOK_ENDPOINTS` lists for org-a.

`npm run dev:user -- <userId> <email> <password> <organizationId> [member|manager]` sets a user's password (12 characters or more), adds the membership with that role (default `member`), and prints a token. `npm run dev:session -- <userId> <organizationId> [member|manager]` prints a token without a password. Both are for local development. There is no signup and no password reset.

## MCP

`/mcp` is an MCP server over Streamable HTTP, through `@ts-pf/mcp` and the MCP SDK ([`handler.ts`](src/servers/http/handler.ts)). It is stateless: each POST is answered on its own, and it serves clients of both the 2026-07-28 protocol and the 2025 one.

- Every procedure at `/rpc` that a caller may use is a tool named by its path: `deals.find` is `deals_find`. Memberships' create, update and delete are left out, since no access rule allows them. The `/auth` router is not a tool, so a model cannot log in.
- A tool call runs in process through the same router as `/rpc`: the same access rules, tenancy, masking, errors and spans. A member's `deals_find` has no `amount`, and a `where` on it is `VALIDATION`.
- Lattice describes each generated tool and sets its annotations: reads are `readOnlyHint: true`, `delete` is `destructiveHint: true`, and `create` and `update` are neither. `deals.close` is the crm's own, so it describes itself in [`toolset.ts`](src/servers/mcp/toolset.ts).

An MCP client authenticates as `/rpc` does: with a session token and an organization header. There is no OAuth sign-in. Get a token from `POST /auth/login` (or `npm run dev:user`), then configure the client with both headers. In Claude Code:

```bash
claude mcp add --transport http crm http://localhost:3000/mcp \
  --header "Authorization: Bearer $TOKEN" \
  --header "x-organization-id: org-a"
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

A membership has a role: `member` (the default) or `manager`. A deal's `amount` is maskable, and the contract's `fields` rule lets managers and support read it.

- A member sees every deal of the organization without its `amount`, on reads, writes and `deals.close`. A `where` or `sort` on `amount` is `VALIDATION`.
- A manager and support see amounts, and a manager filters and sorts by them.
- A member may still set an amount on create or update; the response leaves it out.

| Case | Answer |
| --- | --- |
| No token, a bad or expired one, or an ended session | `401 UNAUTHORIZED`, one body for all (on `/mcp`, a `401` bearer challenge) |
| No organization header, not a member, or no such organization | `403 FORBIDDEN`, one body for all (on `/mcp`, a `FORBIDDEN` tool error) |
| A wrong password, an unknown email, or a locked email at login | `401 UNAUTHORIZED`, one body for all |

The reason is logged, never sent. Logs carry no password and no email; a login refusal names a hash of the email instead.

## Passwords and their limits

- Passwords are hashed with scrypt (N = 2^15, r = 8, p = 3) and a random salt. The parameters are stored with each hash, so they can be raised; a login under older ones rehashes.
- An unknown email costs the same hash as a known one.
- Ten failed logins for one email lock it for the rest of a 15-minute window, whether or not the email has an account. A success resets the count.
- The count has no atomic increment, so concurrent failures can overshoot by a few. Anyone can lock an email for 15 minutes by failing on purpose. Per-IP limits belong in front of the app and are not built.
- Hashes and failed attempts live in the `credentials` and `login_attempts` store collections. Lattice never registers them, so no router, MCP tool or API doc can reach them. A Lattice collection must never use those slugs; a test guards it.

## Tests

`npm test -w @latticecms/example-crm` runs every test on `MemoryStore` and on MongoDB, through mongodb-memory-server. Sessions run in memory with real signed tokens, and the queues on `MemoryQueue` ([`src/test/memory-queue.ts`](src/test/memory-queue.ts)), an adapter of the `@hexok/queue` port with the same delivery rules as RedisQueue. Redis is not needed. Webhooks are sent to a real HTTP server on this machine. MCP tests connect the MCP SDK's own client to `/mcp`.

Two tests keep the package READMEs honest. [`readme-quotes.test.ts`](src/readme-quotes.test.ts) checks that every README code block whose first line names a file, such as `// examples/crm/src/servers/app.ts`, is that file's text, line for line, allowing only a uniform indent to be removed. [`quickstart.test.ts`](src/quickstart/quickstart.test.ts) runs core's quick start, which lives in [`src/quickstart`](src/quickstart).
