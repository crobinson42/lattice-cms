---
status: accepted
strength: default
date: 2026-11-23
revisit: An app needs typed per-collection UI code, an app cannot serve JSON next to its RPC endpoint, or shadalaya ships a data table or schema-driven forms.
supersedes: 0014
---

# 0032. The admin is a React package that renders the catalog the app serves

## Decision

- **API first.** Collections, the HTTP API, the in-process client and MCP came first. The admin is built on them in Phase 3.
- **A React package.** `@latticecms/admin` exports one component, which an app mounts on a catch-all route. The app supplies an authenticated `fetch`, which adds its session token and `x-organization-id`. The admin imports no auth code (0006).
- **The catalog is served, not imported.** The app serves `catalog(contract)` as JSON, behind a session. The admin fetches it at start and interprets its JSON Schema at runtime. It calls procedures by path through a ts-pf `Link`. Its types never import an app's contract, so nothing in the admin's type-check grows with collections (0003).
- **Built on shadalaya primitives, with few dependencies.** The admin builds its own server-driven table, form renderer and router. It refetches after mutations and on focus with `swr`. `@shadalaya/react` is a dependency, because the admin ships CSS precompiled against its class names, so an app needs no Tailwind.
- **The server validates.** A `VALIDATION` issue is shown at the field its path names. The admin has no client-side schema validator.
- **One organization per mount.** The app keys the component by organization, so switching remounts it and empties the cache.

## Why

The crm's runtime contract imports server code (its methods are hexok use cases), so `catalog()` cannot run in a browser. A served catalog always matches the deployed server. An app owns sign-in, hosting and its bundler, so a mounted package fits every app. A standalone app would need a sign-in for every app's `/auth`.

## Rejected

- **A standalone SPA.** It needs a second deployment and its own sign-in, and it cannot share the app's page shell.
- **`import type` plus `catalog()` in the browser.** It cannot work: the contract imports server code.
- **A catalog bundled at build time.** It drifts from the deployed server.
- **OpenAPI as the source.** It is a projection of the catalog, with invented component names.
- **`@ts-pf/swr`.** `createSwr` needs the contract's type, and the admin has only the runtime catalog.
- **TanStack Table, react-hook-form, react-router, JSON Forms.** Their value is client-side sorting, typed routes or a widget system. A server-driven cursor list does not use the first two, and the last two clash with an app's router or shadalaya.
- **shadalaya as a peer.** A newer shadalaya in the app could change class names under the precompiled CSS.
