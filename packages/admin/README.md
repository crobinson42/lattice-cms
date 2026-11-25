# @latticecms/admin

An admin for a [Lattice](../core) app. It renders a collection index, list views and detail views for every collection, from the catalog the app serves. There is no per-collection code: what a page shows comes from the procedures' JSON Schema and their `lattice` meta.

Status: before 1.0.

## Install

```bash
npm install @latticecms/admin react react-dom @ts-pf/client-http @ts-pf/protocol
```

`react` and `react-dom` 19, and `@ts-pf/client-http` and `@ts-pf/protocol` 1, are peer dependencies, shared with the app. The admin imports no server code and no app contract. `swr` 2 and `@shadalaya/react` are its own dependencies; `@shadalaya/react` is pinned to `0.1.0`, the version its stylesheet, `@latticecms/admin/admin.css`, was built against.

The admin is a React component for a page the app bundles, such as with Vite. A bundler warns that `swr` and Base UI mark modules `"use client"`. A browser bundle drops the directive, which is what it wants. Filter `MODULE_LEVEL_DIRECTIVE` in `build.rolldownOptions.onwarn`, as the root README's [Getting started](../../README.md#5-the-admin-page) does.

**Bundle size.** The crm's page, with React, is about 132 kB gzipped, JavaScript and CSS. The admin's own share, without React's chunk, is about 56 kB. The crm's [`bundle.test.ts`](../../examples/crm/src/web/bundle.test.ts) holds both to a budget.

## A one-page admin with a token

The root README's [Getting started](../../README.md#5-the-admin-page) has the smallest page: a token form kept in `sessionStorage`, a `fetch` that adds the token and the organization, and `<Admin>`. A test builds and drives it. The crm's [admin page](../../examples/crm/src/web/app.tsx), quoted below, adds sign-in with a password, an organization switcher and sign-out.

## Serve the catalog

The admin cannot import an app's contract: the contract imports server code. The app serves the contract's `catalog()` as JSON instead, behind its session, beside its RPC endpoint:

```ts
// examples/crm/src/servers/rpc/catalog.ts
export function catalogDocument() {
  return catalog(contract, { prefix: '/rpc' });
}
```

```ts
// examples/crm/src/servers/http/handler.ts
    if (request.method === 'GET' && pathname === '/catalog.json') {
      return forSignedIn(request, 'catalog', () => {
        catalog ??= catalogDocument();
        return catalog;
      });
    }
```

`prefix` is where the app serves its procedures. The admin calls each procedure there, by path. The catalog says which fields are masked, so serve it to signed-in users only. Any signed-in user may read it: it needs no organization.

## Mount it

Mount `<Admin>` on a catch-all route, and import its stylesheet once. The crm's page:

```tsx
// examples/crm/src/web/app.tsx
    <Admin
      // A new organization is a new admin, with an empty cache.
      key={current?.id ?? 'support'}
      fetch={fetch}
      catalogUrl="/catalog.json"
      basePath="/admin"
      header={
        current === undefined ? undefined : (
          <Header
            organizations={organizations}
            picked={current.id}
            onPick={(id) => {
              session.pick(id);
              setPicked(id);
            }}
            onSignOut={signOut}
          />
        )
      }
    />
```

Its `fetch` adds the session token and the organization to every call, and signs the user out on a 401:

```ts
// examples/crm/src/web/session.ts
export function sessionFetch(
  token: string,
  organizationId: string | undefined,
  onUnauthorized: () => void,
): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    request.headers.set('authorization', `Bearer ${token}`);
    if (organizationId !== undefined) {
      request.headers.set(organizationHeader, organizationId);
    }
    const response = await fetch(request);
    if (response.status === 401) onUnauthorized();
    return response;
  };
}
```

| Prop | What it is |
| --- | --- |
| `fetch` | The app's `fetch`. It adds the session token and the organization header to each request. The admin uses it for the catalog and for every call. |
| `catalogUrl` | Where the app serves the catalog JSON. |
| `basePath` | The path the admin is mounted under. Its pages live below it, on the History API. The app serves its page for every path under it, so a reload on a deep link renders. |
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
  - Each relation has a tab, at `/<collection>/<id>/relations/<relation>`: its links page by page, with their fields, each linking to its target, and how many there are.
  - The system fields (`id`, `createdAt`, `updatedAt`) and the tenant field (`x-lattice-tenant`) are shown apart, read-only.
- **Labels:** a field's label is its schema `title` (`.meta({ title })`), or its name in words: `companyId` reads "Company id".

## What it writes

Every write uses one form renderer, built from the procedure's input JSON Schema:

| Schema | Input |
| --- | --- |
| `string` | A text box. `format: date-time` is a date and time, sent as ISO. An `enum` is a select. |
| `number`, `integer` | A number box, with `minimum` and `maximum`. |
| `boolean` | A checkbox, or a select of yes, no and none when null is allowed. |
| A ref (`x-lattice-ref`) | A search over the target's title field (`contains`, through its `find`; Enter picks the first match), or an id box when the target has no title field. |
| An array of strings, enums or refs | One string per line, a checkbox per value, or a list of picked documents. Empty is `null` when null is allowed. |
| Anything else, such as an object | JSON text. |

A default fills the input. A form sends only the fields the user changed, so an untouched field keeps its default on create and its value on edit. Clearing a field sends `null` where its input takes it: a nullable field stores `null`, and on edit an optional field is removed. Clearing a required or defaulted field says "This field is required." at the field and sends nothing. No input takes the system fields or the tenant field.

- **Create** (`/<collection>/new`) renders `create`'s input, then opens the new document.
- **Edit** (`/<collection>/<id>/edit`) renders `update`'s input, filled from `get`, and sends only the fields that changed from what the form opened with, even if the document refetches meanwhile. A field the caller did not receive is not in the form, so a withheld value is never sent back.
- **Delete** asks first, then shows the list. A `REFERENCED` refusal says what still refers to the document, such as "Deals still refer to this company (Company id).", and links to that list filtered to those documents. When a relation's links refer to it, it names the relation, such as "Deals still list this contact (Contacts).", and links to the parents' list, which cannot be filtered to the ones that do.
- **Methods.** A method whose input has an `id` is an action on its document's page; one without is an action on its collection's list. Each is labelled by its name in words, with its summary beside it. Its form is its input but `id`. With no other field it is a button: a read runs at once, and a write asks first. A destructive method always asks. When it returns the page's document, the page refreshes; anything else is shown read-only.
- **Relations.** A relation's tab edits its `set`: it loads every link, up to the 1000 one set takes, and says so when there are more. Add a target, remove one, or change a link's fields, then save the whole set after a confirmation. A refusal keeps the edits.

After a write, the admin refetches what the write could have changed: the collection's documents, lists and counts, and a relation's target, where they stand on screen. A delete empties the collection's cached lists instead, so the list it opens fetches fresh and never shows the deleted document.

The server decides what a caller sees, and the admin shows what it is sent:

- A field withheld from the caller is absent from the document and from the list's columns. A field rule is per caller, not per document, so a maskable field that no loaded document carries is withheld from this caller.
- A filter or sort on a withheld field is refused as `VALIDATION`. The admin shows the server's message at that filter or column.
- A `VALIDATION` on a write shows each issue at the field its path names, and any other issue in the form's alert. The admin does not validate before the server does.
- Any other refusal, such as `FORBIDDEN`, `NOT_FOUND`, `CONFLICT` or an app's declared error, shows its code and message. A missing document shows not-found.

## What it leaves out

Bulk actions and bulk edits, OR groups, multi-column sort, CSV import and export, saved views, dashboards, audit history, i18n, client-side validation, and per-collection custom pages, forms or field renderers.
