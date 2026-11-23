---
status: accepted
strength: default
date: 2026-11-23
revisit: An app needs a widget, title field or column that the schema cannot imply, or Zod's meta stops reaching the JSON Schema that ts-pf emits.
---

# 0033. The catalog carries Lattice's facts, and the admin derives its UI from the schema

## Decision

- **Field facts go in Zod meta,** which ts-pf already carries into `catalog()`, OpenAPI and MCP:
  - `ref()` adds `x-lattice-ref: '<slug>'`;
  - a maskable field carries `x-lattice-maskable: true`.
  
  The runtime markers stay. The meta is what gets emitted, and it is written in the same place as the marker, from the same value.
- **A sort item is an enum** of the keys `sortable()` accepts, so a client sees the valid keys. Today's two error messages are kept.
- **Procedure facts go in procedure meta.** Every Lattice procedure carries a `lattice` key: `{ collection, label, operation }`, plus `relation` for `list` and `set`, or `method` for a method. Core exports its type as `LatticeMeta`. An override keeps the generated operation's meta.
- **A method describes itself** with `summary` and `effect` statics on its use case. Both are required for a method and refused for an override, through the composition checks. Core emits them as `docs` and `mcp` meta.
- **Labels.** `collection(slug, { label: { singular, plural } })` is optional, and it defaults from the slug. Generated summaries use the label. A field's label is its name in words, or JSON Schema's `title` through Zod `.meta({ title })`.
- **Everything else the admin derives:**
  - the title field (the first required string among `name`, `title`, `label` and `email`, never a maskable field);
  - list columns;
  - field order (schema order);
  - widgets (from the type).
  
  Nothing is declared until an app needs something a default cannot give.

## Why

Core knows these facts. A client that guesses them from description text or path segments breaks silently. Zod meta survives `pick`, `optional` and arrays, and adds 18 type instantiations for 120 fields. A per-field UI option added 2.2%, and it described each field a second time, away from its schema (0003). The method's use case is hexok's own statics bag (0001), and both MCP and the admin read what it says.

## Rejected

- **A collection-level `ui` option** with columns, a title field and per-field widgets. It costs type-check time and duplicates the schema, for choices the defaults already make.
- **A `method()` wrapper, or a meta map on composition.** The first needs a new export and a second shape in `methods`; the second needs a map kept in step by hand.
- **A separate `sortable` list in meta.** It would be a second place that says what can be sorted.
- **The admin keeping its own copy of the meta shape.** The copy would drift.
