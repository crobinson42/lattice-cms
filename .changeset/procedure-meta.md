---
'@latticecms/core': minor
---

Generated procedures describe themselves. Each carries `docs({ summary })` and `mcp({ effect })` in its `.meta()`: reads are `read`, `create` and `update` are `write`, and `delete` and a relation's `set` are `destructive`. An app gets OpenAPI summaries, JSDoc in `@ts-pf/codegen` clients, and MCP tool descriptions with `readOnlyHint` and `destructiveHint`, with no code. The effect is literal in the contract's type, so `@ts-pf/mcp`'s `all(node, { effect })` selects in types what it selects at runtime. An override keeps its procedure's meta; a method has none, and the app describes it.

A maskable field's `where` entry, and a `sort` that could name it, now say that a caller who may not read the field is refused with `VALIDATION`, so OpenAPI and MCP clients see it in the input schema.

`@ts-pf/docs` and `@ts-pf/mcp` are new peer dependencies. Core imports `docs` from `@ts-pf/docs` and only `@ts-pf/mcp/meta`, which has no dependencies. Install them in the app: `npm install @ts-pf/docs @ts-pf/mcp`.
