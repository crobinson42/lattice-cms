# examples/crm

A CRM on Lattice: companies, contacts and deals, each organization's own, on MongoDB. It is the example the `@latticecms/core` README quotes, and the app every Lattice change is checked against. It is private and never published.

## Run it

It runs as two processes: the HTTP server and the worker. Both need MongoDB (a replica set, for transactions) and Redis, for sessions and the event queues.

```bash
npm run build -w @latticecms/example-crm
export MONGODB_URL=mongodb://localhost:27017/?replicaSet=rs0
export REDIS_URL=redis://localhost:6379
export AUTH_TOKEN_SECRETS=$(node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))")
export AUTH_TOKEN_ISSUER=crm AUTH_TOKEN_AUDIENCE=crm
npm run dev:user -w @latticecms/example-crm -- ann ann@example.com 'a long password' org-a manager
npm start -w @latticecms/example-crm
npm run worker -w @latticecms/example-crm   # in another terminal
```

| Variable | Meaning |
| --- | --- |
| `MONGODB_URL`, `MONGODB_DATABASE` | The store. The database defaults to `crm`. |
| `REDIS_URL` | The session store, and the domain event and webhook queues. |
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
deals.close ──publish──▶  crm:domain: deal.closed  ──▶  process deal.closed (crm:deals.send-closed-webhook)
                                                          │  reads the deal inside the event's organization
                                                          ▼
                          crm:webhooks: webhooks   ──▶  @hexok/webhooks sender ──POST──▶ the organization's endpoints
```

- The HTTP process publishes every domain event to the queue, on a topic named by its token: Lattice's `deals.created` and the rest, and `deal.closed` from `deals.close`. It only publishes.
- The worker subscribes each handler in its own consumer group, `crm:<handler token>`, so each handler gets every event. A handler that throws is retried, up to 10 deliveries, then given up. A payload the event schema rejects is logged and dropped.
- Handlers are system code: they read and write through repos with `tenancy.scope(C, event.tenantId)`, never an actor's access. `deal.closed` carries `tenantId` for that.
- `SIGINT` and `SIGTERM` stop the worker taking events, wait for the handlers in flight, stop the webhook sender, then close the queues and the store.
- Each handled event is one OpenTelemetry consumer span, `process deal.closed`, and the handler's store calls are its children.

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
- `GET /health` answers `{ ok: true }`.

`npm run dev:user -- <userId> <email> <password> <organizationId> [member|manager]` sets a user's password (12 characters or more), adds the membership with that role (default `member`), and prints a token. `npm run dev:session -- <userId> <organizationId> [member|manager]` prints a token without a password. Both are for local development. There is no signup and no password reset.

## How a request is authenticated

The edge builds the actor before Lattice sees it ([`handler.ts`](src/servers/http/handler.ts)):

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
| No token, a bad or expired one, or an ended session | `401 UNAUTHORIZED`, one body for all |
| No organization header, not a member, or no such organization | `403 FORBIDDEN`, one body for all |
| A wrong password, an unknown email, or a locked email at login | `401 UNAUTHORIZED`, one body for all |

The reason is logged, never sent. Logs carry no password and no email; a login refusal names a hash of the email instead.

## Passwords and their limits

- Passwords are hashed with scrypt (N = 2^15, r = 8, p = 3) and a random salt. The parameters are stored with each hash, so they can be raised; a login under older ones rehashes.
- An unknown email costs the same hash as a known one.
- Ten failed logins for one email lock it for the rest of a 15-minute window, whether or not the email has an account. A success resets the count.
- The count has no atomic increment, so concurrent failures can overshoot by a few. Anyone can lock an email for 15 minutes by failing on purpose. Per-IP limits belong in front of the app and are not built.
- Hashes and failed attempts live in the `credentials` and `login_attempts` store collections. Lattice never registers them, so no router, MCP tool or API doc can reach them. A Lattice collection must never use those slugs; a test guards it.

## Tests

`npm test -w @latticecms/example-crm` runs every test on `MemoryStore` and on MongoDB, through mongodb-memory-server. Sessions run in memory with real signed tokens, and the queues on `MemoryQueue` ([`src/test/memory-queue.ts`](src/test/memory-queue.ts)), an adapter of the `@hexok/queue` port with the same delivery rules as RedisQueue. Redis is not needed. Webhooks are sent to a real HTTP server on this machine.
