---
'@latticecms/core': minor
---

`hexok`, `@ts-pf/contract`, `@ts-pf/protocol` and `@ts-pf/server` are peer dependencies, as `zod` and `@hexok/logger` are. Install them in the app: `npm install @latticecms/core hexok @ts-pf/contract @ts-pf/protocol @ts-pf/server zod @hexok/logger`. The app and Lattice then share one copy of each, so hexok's classes and ts-pf's types are the same on both sides.
