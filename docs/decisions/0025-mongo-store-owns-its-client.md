---
status: accepted
strength: default
date: 2026-11-21
revisit: Apps routinely need to share one MongoClient pool with other libraries in the same process, or mongodb-memory-server stops shipping a mongod for a platform the team develops on.
---

# 0025. `MongoStore` owns its client, and its tests run on mongodb-memory-server

## Decision

`new MongoStore({ url, database, client? })` creates and owns its `MongoClient`. `client` takes `MongoClientOptions`. `start()` connects and pings, and `stop()` closes the client. A call before `start()`, during it, or after `stop()` rejects with a `MongoStoreError`, using ioredis-lifecycle's codes (`NotStarted`, `Starting`, `Stopped`). `mongodb` is a dependency of `@latticecms/store-mongo`, and `@latticecms/core` is a peer.

The package's tests run against `mongodb-memory-server`. A vitest `globalSetup` starts one single-node replica set per run, and each test gets its own database on it. It is a devDependency of store-mongo only.

## Why

The store needs its client for more than queries. The migrations runner (step 7) and transactions (step 8) both need it, so the store should own the client, as hexok's Redis adapters own their connections, rather than ask the app for it back. One owner also lets the store refuse calls before it has connected.

Transactions need a replica set. mongodb-memory-server starts a real one with nothing installed: no Docker and no manual `rs.initiate`. It works offline after the first download, and a test run starts it in about 2–4 seconds.

## Rejected

- **`new MongoStore({ db })`, or `{ client, database }` from the app.** The app could share one pool with other code, but `mongodb` would become a peer, every app would write the lifecycle, and the store could not guard against calls before connecting.
- **hexok's pattern: `MONGODB_URL` plus a CI `services:` container.** Locally, without Mongo running, the tests silently skip, and the replica set needs an init step in CI.
- **testcontainers.** Every contributor needs Docker, a pull of about 700 MB, and a large devDependency tree.
