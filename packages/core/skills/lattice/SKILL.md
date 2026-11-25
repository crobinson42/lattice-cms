---
name: lattice
description: >
  Build features in an app made with Lattice CMS (@latticecms/core). Use when
  the task adds or changes a collection, its access, tenancy, relations,
  masked fields, an override, a method, an event handler on a collection's
  events, a data migration, or a test of any of them. Follow its steps, and
  read the reference it names before writing that piece.
license: MIT
metadata:
  short-description: Build features with Lattice collections
---

# Lattice

Import from `@latticecms/core`. A collection is a slug and a Zod schema. `framework()` compiles each one into hexok use cases, hexok events and a ts-pf contract, with `find`, `count`, `get`, `create`, `update` and `delete`. Every generated piece is a real hexok `UseCase` and `Event`, and a real ts-pf procedure, so hand-written code takes its place with the same types.

The app owns authentication, HTTP, the store's lifecycle, migrations' timing and the worker. Lattice owns the collection's procedures, its access and tenant filters, masking, population and its events.

The running shape is `examples/crm`. Companies, contacts and deals belong to organizations. A deal refers to a company, links contacts through a relation, and hides its amount from members. A deal closes once through a method, and its delete is an override that archives it. Use the app's real story. The crm is only the shape.

## Concepts

Read the reference before writing that concept.

| Concept | Reference | Place |
| --- | --- | --- |
| Collection | [references/collection.md](references/collection.md) | Domain. A slug, a schema, a tenant, a label and indexes. |
| Access | [references/access.md](references/access.md) | Composition. Who may do what, as a filter in the query. |
| Tenancy | [references/tenancy.md](references/tenancy.md) | Family and collection. Each organization's rows kept apart. |
| Relations | [references/relations.md](references/relations.md) | Domain. `ref()`, `many()`, `onDelete` and population. |
| Masking | [references/masking.md](references/masking.md) | Domain and composition. Fields a caller's rule withholds. |
| Override | [references/override.md](references/override.md) | Application. A hand-written use case in place of a generated one. |
| Method | [references/method.md](references/method.md) | Application. A procedure of the collection's own, such as `deals.close`. |
| Event handler | [references/event-handler.md](references/event-handler.md) | Application. Work that follows a collection's event or the app's own. |
| Testing | [references/testing.md](references/testing.md) | Tests. `build()`, `createLocalClient` and `MemoryStore`, and the store suite. |
| CLI | [references/cli.md](references/cli.md) | Tooling. `lattice collection`, `migration` and `migrate`. |

## How to build a feature

Walk these steps before you edit files.

1. **Thought.** State one user story: who acts, and what they can do. Example: a manager closes a deal as won.
2. **Research.** Find what exists: the collection, its entry in the composition (`framework(...).collection(...)`), the family, the events catalog, the overrides and methods, the handlers and the tests.
3. **Plan.** Write the steps below, each marked `exists`, `add` or `none`. Then implement them in that order. Read each step's reference first.

### 1. The collection

A story that stores a new kind of thing is a collection. Run `lattice collection <slug>` in the app: it writes the file, a test, the registration and the events catalog entries. Then edit the schema. Read [references/collection.md](references/collection.md) and [references/cli.md](references/cli.md).

A new field on an existing collection is a schema change. When stored documents lack it, add a data migration with `lattice migration <name>`.

### 2. Access

Every collection has an `access` map at composition. A scaffolded collection is open to any signed-in caller. Tighten it to the story. Read [references/access.md](references/access.md).

### 3. Tenancy

A collection whose rows belong to an organization has `tenant: 'organizationId'`. One every organization shares, such as the organizations themselves, has none. Read [references/tenancy.md](references/tenancy.md).

### 4. Relations

A field that holds another document's id is a `ref()`. A list of links with fields of their own, such as a contact's role on a deal, is a `many()` relation. Decide what deleting the parent does. Read [references/relations.md](references/relations.md).

### 5. Masking

A field some callers may not read, such as a deal's amount, is `maskable`, with a read rule at composition. Read [references/masking.md](references/masking.md).

### 6. Overrides and methods

When a generated operation is wrong for the story, override it: a delete that archives, or an update that refuses to close a deal and then runs the generated update. When the story is an action of its own, add a method: closing a deal. Both are hand-written use cases in the app's family. Read [references/override.md](references/override.md) and [references/method.md](references/method.md).

### 7. Events and handlers

Generated writes publish the collection's events. Overrides and methods publish their own. Work that follows a write, in this product, is an event handler. Work for another product or a customer is a mapping at the edge. Read [references/event-handler.md](references/event-handler.md).

### 8. Tests

Test the story through the contract, with `createLocalClient` over the built app. Read [references/testing.md](references/testing.md).

## What Lattice does not do

Use hexok and ts-pf directly for these, with their skills (`hexok`, `ts-pf-*`).

- **Authentication.** The edge proves the caller with `@hexok/auth` and builds the actor. Use cases receive the actor and never import auth or HTTP.
- **Serving.** `@ts-pf/server-http`'s `FetchHandler` serves the built `app`. The context function is the app's.
- **Clients, MCP and OpenAPI.** `@ts-pf/client`, `@ts-pf/mcp`, `@ts-pf/openapi` and `@ts-pf/codegen` read the contract. Lattice gives each procedure its summary and effect.
- **Delivery.** Queues, workers, webhooks and integration events are hexok's packages. Lattice publishes collection events to the app's publisher, and nothing more.
- **Read events and pattern subscriptions.** Reads publish nothing. A handler names its event.
- **An outbox.** A publish after a write can be lost in a crash.
- **File uploads.** Not built yet.

## Conventions

- One family per app. Generated and hand-written use cases extend it.
- Access and tenancy are filters in the query. Never load a row and then decide whether the caller may see it.
- Every `Repo` call takes a scope: `ctx.access.scope(C, action)` in a use case, `tenancy.scope(C, tenantId)` in a handler, `unscoped` in trusted code that acts for no tenant.
- No casts, no `any`, no `!`. A type error from Lattice names the rule; fix the code, not the type.
- No parallel primitive. A use case is a hexok `UseCase` from the family. An event is a hexok `Event` in the app's one catalog. A procedure comes from the framework.
- The tenant field is stamped, never written. It is not in create or update input.
- A collection event stays inside the product. Map it to an integration event or a webhook at the edge.
- Generated code reads the stored shape. A migration reads the raw database, because old documents have the old shape.

## When Lattice changes

A change to a concept updates its reference in the same change. Each code block here quotes a file of `examples/crm` and names it, and the crm's tests fail when a quote no longer matches.
