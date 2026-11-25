---
title: Lattice CMS
description: Collections that compile into hexok use cases and a ts-pf contract.
---

Lattice CMS is a TypeScript framework for internal tools, CRMs, admin panels and portals. A collection is a Zod schema with a slug. Lattice compiles it into [hexok](https://github.com/crobinson42/hexok) use cases and events, and a [ts-pf](https://github.com/crobinson42/ts-pf) contract. An admin renders from the catalog the app serves.

[Getting started](/lattice-cms/getting-started/) builds an admin for companies and their contacts, from an empty directory.

## Installing

```bash
npm i @latticecms/core @latticecms/admin
npm i -D @latticecms/cli
```

Core and the admin have peer dependencies on hexok, ts-pf and Zod. [Getting started](/lattice-cms/getting-started/#1-install) installs the full set.

## Packages

Each package page is the package's README.

- [@latticecms/core](/lattice-cms/packages/core/): collections, the framework, access, tenancy, relations, masking and events, and an in-memory store.
- [@latticecms/store-mongo](/lattice-cms/packages/store-mongo/): the MongoDB store, and data migrations.
- [@latticecms/admin](/lattice-cms/packages/admin/): a React admin rendered from the catalog an app serves.
- [@latticecms/cli](/lattice-cms/packages/cli/): the `lattice` command, which scaffolds collections and migrations, and runs migrations.

## Agent skill

Core ships an agent skill named `lattice`. It walks a feature from a collection to an override, with one reference per concept. In an app that installs core, link it into the agents' skill directories:

```bash
npx skills experimental_sync -y -r
```

It sits beside hexok's `hexok` skill and the `ts-pf-*` skills, which the same command links. [The agent skill](/lattice-cms/packages/core/#the-agent-skill) has more.

## Links

The repository is [crobinson42/lattice-cms](https://github.com/crobinson42/lattice-cms) on GitHub. On npm, the packages are in the `@latticecms` scope, such as [@latticecms/core](https://www.npmjs.com/package/@latticecms/core). [`examples/crm`](https://github.com/crobinson42/lattice-cms/tree/main/examples/crm) is the example app every change is checked against.
