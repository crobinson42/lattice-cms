# @latticecms/admin

An admin for a [Lattice](../core) app. It renders a collection index, list views and detail views for every collection, from the catalog the app serves. There is no per-collection code: what a page shows comes from the procedures' JSON Schema and their `lattice` meta.

Status: unpublished, before 1.0. This version reads. Create and edit forms, delete, methods and relation editing come next.

## Install

```bash
npm install @latticecms/admin react react-dom @ts-pf/client-http @ts-pf/protocol
```

`react`, `react-dom`, `@ts-pf/client-http` and `@ts-pf/protocol` are peer dependencies, shared with the app. The admin imports no server code and no app contract. `@shadalaya/react` and `swr` are the admin's own dependencies. `@shadalaya/react` is pinned to the version the stylesheet was built against.

## Serve the catalog

The admin cannot import an app's contract: the contract imports server code. The app serves `catalog(contract)` as JSON instead, behind its session, beside its RPC endpoint:

```ts
import { catalog } from '@ts-pf/docs';

// Built once: the contract does not change while serving.
const document = catalog(contract, { prefix: '/rpc' });

if (request.method === 'GET' && pathname === '/catalog.json') {
  if (!(await isSignedIn(request))) return new Response(null, { status: 401 });
  return Response.json(document);
}
```

`prefix` is where the app serves its procedures. The admin calls each procedure there, by path.

## Mount it

Mount `<Admin>` on a catch-all route, and import its stylesheet once:

```tsx
import { Admin } from '@latticecms/admin';
import '@latticecms/admin/admin.css';

<Admin
  key={organizationId}
  fetch={appFetch}
  catalogUrl="/catalog.json"
  basePath="/admin"
  header={<OrganizationSwitcher />}
/>;
```

| Prop | What it is |
| --- | --- |
| `fetch` | The app's `fetch`. It adds the session token and the organization header to each request. The admin uses it for the catalog and for every call. |
| `catalogUrl` | Where the app serves the catalog JSON. |
| `basePath` | The path the admin is mounted under. Its pages live below it, on the History API. |
| `header` | Optional. The app's part of the top bar, such as an organization switcher and sign-out. |

The admin follows the browser's back and forward, and its own links. It does not see the app's `history.pushState`: to send the user to an admin page from app code, follow a link to it, or push the URL and dispatch a `popstate` event. A list keeps its filters, sort and page in its URL, so back, forward and reload return to it.

The admin has no sign-in and no auth code. The app owns its session: on a 401, its `fetch` can clear the session and show its sign-in page.

**Key it by organization.** `key={organizationId}` remounts the admin when the user switches organization. Each mount has its own cache, so one organization's rows never show under another's. Cache keys do not include the organization header, so without the key a switch would show stale rows until they refetch.

The stylesheet is compiled at the admin's build, with Tailwind's preflight and the shadalaya tokens. The app needs no Tailwind. Preflight resets element styles, so serve the admin on its own page.

## What it renders

- **The index:** every collection, by its label (`collection(slug, { label })`, or one from the slug).
- **A list:**
  - Columns: the title field, then the required scalar fields in schema order, up to six in all, then `updatedAt`. The title field is the first required string among `name`, `title`, `label` and `email`, never a maskable one. A ref shows its target's title, from `find`'s `populate`.
  - Filters: at most one condition per field, ANDed. Each field offers the operators its `where` schema allows: `is`, `is one of`, `>`, `contains`, `exists` and the rest.
  - Sort: one column, by clicking its header, for the keys `find`'s sort enum lists.
  - Pages: Next and Back over cursors. There are no page numbers ([0008](../../docs/decisions/0008-cursor-pagination.md)).
  - A count of what the filters match, from `count` with the same `where`.
  - A refused call is not retried: it would be refused again. Data refetches when the window regains focus.
- **A document:** `get` with every field `populate` takes.
  - A populated ref links to its document, labelled by the target's title field. A ref the caller may not read shows its id and "no access".
  - A populated relation lists its links, each linking to its target.
  - The system fields (`id`, `createdAt`, `updatedAt`) and the tenant field are shown apart, read-only.
- **Labels:** a field's label is its schema `title` (`.meta({ title })`), or its name in words: `companyId` reads "Company id".

The server decides what a caller sees, and the admin shows what it is sent:

- A field withheld from the caller is absent from the document and from the list's columns. A field rule is per caller, not per document, so a maskable field that no loaded document carries is withheld from this caller.
- A filter or sort on a withheld field is refused as `VALIDATION`. The admin shows the server's message at that filter or column.
- Any other refusal, such as `FORBIDDEN`, shows its code and message. A missing document shows not-found.

## What it leaves out

Bulk actions, OR groups, multi-column sort, CSV import and export, saved views, dashboards, audit history, i18n, client-side validation, and per-collection custom pages or renderers.
