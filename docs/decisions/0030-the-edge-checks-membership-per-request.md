---
status: proposed
strength: default
date: 2026-11-21
revisit: The pilot's identity provider supplies organizations or roles as claims, or the per-request membership lookup shows up in latency.
---

# 0030. The edge picks the active organization from a header and checks membership on every request

## Decision

- **The session holds only the user.** The edge authenticates with `@hexok/auth`'s `Sessions` and a signed `JoseSessionToken`. The session store is Redis in dev and production, and memory in tests. Logout and expiry delete the session.
- **A header names the organization.** `x-organization-id` names the active organization. Before it builds the actor, the edge checks membership on every request, with one indexed `count` on the app's `memberships` collection. Only then does `tenantOf` read the organization.
- **Support comes from server config.** A user listed in the deploy's config is a support actor (0024). Nothing in a request can set the flag.
- **The edge refuses.** No credential, or a bad one, is 401 `UNAUTHORIZED`, and every cause gives the same body. No organization, or not a member, is 403 `FORBIDDEN`, and an organization that does not exist gives the same body as one the user is not a member of. `CallContext`'s actor stays a valid actor.
- **Anonymous procedures, such as login, live on their own ts-pf router** with their own context, outside the Lattice families.

## Why

The check runs on every request, so switching organizations needs no new login, and a revoked membership is refused on the next request. Lattice sees only a verified actor, so access and tenancy stay filters (0005), and no procedure handles a missing actor.

## Rejected

- **The organization in the session.** Each switch needs a new login, and a revoked membership stays live until the session ends.
- **Organizations in token claims.** They go stale on revocation, and `JoseSessionToken` carries no claims by design.
- **A default organization when the header is missing.** It is a silent tenant choice.
- **A membership check inside Lattice,** in a guard or an access function. That is load-then-check, and it teaches core about memberships.
- **`CallContext<Actor | undefined>`.** Every guard, access function and `tenantOf` would handle a missing actor. app-template's optional caller needs a cast to reach its signed-in context.
- **A stateless JWT authenticator, or a Mongo session store in the app.** Either one means owning an authenticator or an adapter that hexok should own.
- **Dev headers behind `NODE_ENV`, or `DevAuthenticator` in dev.** Either one leaves a second auth path in production code.
