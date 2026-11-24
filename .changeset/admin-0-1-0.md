---
'@latticecms/admin': minor
---

First release. `<Admin>` renders an admin for a Lattice app from the catalog the app serves, with no per-collection code, and `@latticecms/admin/admin.css` styles it with no Tailwind in the app.

- Props: `fetch` (the app's, with its session and organization), `catalogUrl`, `basePath` and an optional `header`. The app keys it by organization.
- The catalog is read with a type guard over what the admin uses, and an unreadable one names what it lacks. Procedures are grouped by their `lattice` meta, and called by path through a ts-pf `FetchLink` and swr, refetched on focus.
- Pages on the History API under `basePath`: the collection index, a list (columns from the schema, a filter per field, a one-column sort, Next and Back over cursors, and a count, kept in the URL), and a document (populated refs as links, a tab per relation, withheld fields absent, system fields read-only). Unknown routes and missing documents show not-found.
- Writes from one form renderer over the procedure's input schema: create, edit (only the changed fields, never a withheld one), delete after a confirmation (a `REFERENCED` refusal links to what still refers to the document), methods as document or collection actions, and a relation tab that pages its links and sets them all at once. A ref is picked by searching its target's title; a field outside the subset is JSON text.
- After a write, what it changed refetches in place. After a delete, the list fetches fresh, so it never shows the deleted document.
- Refusals show: a `VALIDATION` issue at the filter, column or form field its path names, and any other code with its message.
- About 56 kB gzipped without React, which the crm's bundle test holds to a budget.

Install the peers in the app: `npm install @latticecms/admin react@^19 react-dom@^19 @ts-pf/client-http@^1 @ts-pf/protocol@^1`. See the [README](./README.md#install).
