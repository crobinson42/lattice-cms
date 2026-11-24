# Lattice CMS

Collections that compile into [hexok](https://github.com/crobinson42/hexok) use cases and a [ts-pf](https://github.com/crobinson42/ts-pf) contract, for internal tools, CRMs, admin panels and portals.

Status: before 1.0. Nothing is published yet.

- Design: [docs/architecture.md](docs/architecture.md)
- Decisions in force: [docs/decisions/README.md](docs/decisions/README.md)
- Current work: [docs/plans/phase-3.md](docs/plans/phase-3.md)
- Working on this repo, by hand or with an agent: [AGENTS.md](AGENTS.md)

## Getting started

This builds an admin for companies and their contacts, from an empty directory, in a few minutes. You need Node 24.

### 1. Install

In an empty directory:

```bash
npm init -y
npm pkg set type=module
npm install @latticecms/core @latticecms/admin hexok@^2 zod@^4 @hexok/auth@^0.1 @hexok/logger@^0.2 @opentelemetry/api@^1 @ts-pf/contract@^1 @ts-pf/docs@^1 @ts-pf/mcp@^1 @ts-pf/protocol@^1 @ts-pf/server@^1 @ts-pf/server-http@^1 @ts-pf/client-http@^1 react@^19 react-dom@^19 srvx@^1
npm install --save-dev @latticecms/cli typescript@^6 vite@^8 vitest@^5 @types/node @types/react@^19 @types/react-dom@^19
```

Tell the `lattice` command where things go, and how to build and start the app:

```bash
npm pkg set lattice.collections=src/collections lattice.composition=src/app.ts lattice.events=src/events.ts lattice.tenant=organizationId
npm pkg set "scripts.build=tsc && vite build" "scripts.start=node dist/src/server.js"
mkdir -p src/collections
```

```json tsconfig.json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "nodenext",
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"],
    "jsx": "react-jsx",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "outDir": "dist"
  },
  "include": ["src", "web"]
}
```

### 2. The empty app

Who calls is the actor: a user, acting in one organization. Every use case shares one family, which reads the organization from the actor, so each organization sees only its own rows.

```ts src/family.ts
import { family } from '@latticecms/core';
import { z } from 'zod';

const actor = z.object({ userId: z.string(), organizationId: z.string() });

export type Actor = z.output<typeof actor>;

/** The app's one use case family: a member acting in one organization. */
export const AppUseCase = family({
  actor,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});
```

The app is one `framework()` chain, with a collection per link, and one catalog of events. Both start empty.

```ts src/app.ts
import { framework } from '@latticecms/core';
import { AppUseCase } from './family.js';

/** Any member may do this. The edge has checked the membership. */
const anyone = () => true;

/** The app's API. `lattice collection` adds each collection to it. */
export const app = framework({ family: AppUseCase });
```

```ts src/events.ts
import { EventCatalog } from 'hexok';

/** The app's events. `lattice collection` adds each collection's events. */
export class AppEvents extends EventCatalog('app', {}) {}
```

### 3. Collections

Add companies and contacts, which belong to an organization, and memberships, which say who belongs to which:

```bash
npx lattice collection companies
npx lattice collection contacts
npx lattice collection memberships --global
```

Each command writes a collection with a `name`, its test, its link in `src/app.ts`, and its events in `src/events.ts`. Now edit two of them. A contact refers to its company, so a company with contacts cannot be deleted:

```ts src/collections/contacts.ts
import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.email().optional(),
    // A company with contacts cannot be deleted until they are gone.
    companyId: ref('companies').optional(),
  }),
  tenant: 'organizationId',
});
```

A membership pairs a user with an organization. It is global: it is not inside one organization.

```ts src/collections/memberships.ts
import { collection } from '@latticecms/core';
import { z } from 'zod';

/** Which organizations a user may act in. The edge reads it on every call. */
export const Memberships = collection('memberships', {
  schema: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  }),
  indexes: [{ fields: { userId: 1, organizationId: 1 }, unique: true }],
});
```

Its test checked a `name`, so it now checks the new fields:

```ts src/collections/memberships.test.ts
import { describe, expect, it } from 'vitest';
import { app } from '../app.js';
import { Memberships } from './memberships.js';

// What the scaffold made. Test behavior through the app's own setup.
describe('memberships', () => {
  it('is in the app, with its operations', () => {
    const operations = ['find', 'count', 'get', 'create', 'update', 'delete'];
    const keys = Object.keys(app.contract.memberships);
    expect(keys).toEqual(expect.arrayContaining(operations));
  });

  it('parses a membership, and refuses one without its fields', () => {
    const membership = { userId: 'admin', organizationId: 'acme' };
    expect(Memberships.schema.parse(membership)).toEqual(membership);
    const refused = Memberships.schema.safeParse({});
    const paths = refused.error?.issues.map((issue) => issue.path);
    expect(paths).toEqual([['userId'], ['organizationId']]);
  });
});
```

Each collection is open to any member. A member must not grant itself memberships, so in `src/app.ts`, which the commands edited, memberships becomes read-only:

```ts src/app.ts
import { framework } from '@latticecms/core';
import { Companies } from './collections/companies.js';
import { Contacts } from './collections/contacts.js';
import { Memberships } from './collections/memberships.js';
import { AppUseCase } from './family.js';

/** Any member may do this. The edge has checked the membership. */
const anyone = () => true;

/** The app's API. `lattice collection` adds each collection to it. */
export const app = framework({ family: AppUseCase })
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Memberships, {
    // A member reads its own memberships. Only trusted code writes them.
    access: { read: ({ actor }) => ({ userId: { eq: actor.userId } }) },
  });
```

Run the tests:

```bash
npx vitest run src
```

### 4. The server

The server builds the app over an in-memory store and serves it at `/rpc`. Its edge signs callers in with a token from `ADMIN_TOKEN`, checks their membership of the organization each call names, and only then builds the actor. It also serves the catalog the admin reads, and the admin page.

```ts src/server.ts
import { readFile } from 'node:fs/promises';
import { bearerToken, StaticTokenAuthenticator } from '@hexok/auth';
import { ConsoleLogger } from '@hexok/logger';
import { type CallContext, MemoryStore, unscoped } from '@latticecms/core';
import { catalog } from '@ts-pf/docs';
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import type { EventInstance } from 'hexok';
import { serve } from 'srvx';
import { staticMiddleware } from 'srvx/static';
import { app } from './app.js';
import type { AppEvents } from './events.js';
import type { Actor } from './family.js';

const logger = new ConsoleLogger();
const store = new MemoryStore();
const built = app.build({
  store,
  // Where collection events go: nowhere yet.
  events: { async publish(_event: EventInstance<typeof AppEvents>) {} },
});
await store.start();
await built.ensure();

// One member of one organization, kept in memory. Trusted code writes it.
await built.repos.memberships.insert(
  { userId: 'admin', organizationId: 'acme' },
  unscoped,
);

// The token you sign in with names the user.
const token = process.env.ADMIN_TOKEN;
if (token === undefined) throw new Error('Set ADMIN_TOKEN');
const auth = new StaticTokenAuthenticator({
  tokens: [[token, { userId: 'admin' }]],
});

/** The user the request's token names, if it names one. */
async function userOf(request: Request): Promise<string | undefined> {
  const header = request.headers.get('authorization');
  const user = await auth.authenticate(bearerToken(header));
  return user.ok ? user.value.userId : undefined;
}

/** Every call's context: the user, a member of the organization it names. */
async function context(request: Request): Promise<CallContext<Actor>> {
  const userId = await userOf(request);
  if (userId === undefined) {
    throw new PFError({ code: 'UNAUTHORIZED', status: 401, message: 'Sign in' });
  }
  const organizationId = request.headers.get('x-organization-id') ?? '';
  const { docs } = await built.repos.memberships.find(
    {
      where: { userId: { eq: userId }, organizationId: { eq: organizationId } },
      limit: 1,
    },
    unscoped,
  );
  if (docs.length === 0) {
    throw new PFError({ code: 'FORBIDDEN', status: 403, message: 'Not a member' });
  }
  return { actor: { userId, organizationId }, logger };
}

const rpc = new FetchHandler(built.app, { onError: built.onError(logger) });
const document = catalog(app.contract, { prefix: '/rpc' });
const page = await readFile('dist/public/admin/index.html');

const server = serve({
  port: process.env.PORT ?? 3000,
  hostname: 'localhost',
  silent: true,
  middleware: [staticMiddleware({ dir: 'dist/public' })],
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/catalog.json') {
      const signedIn = (await userOf(request)) !== undefined;
      return signedIn
        ? Response.json(document)
        : new Response(null, { status: 401 });
    }
    if (pathname.startsWith('/admin')) {
      return new Response(page, { headers: { 'content-type': 'text/html' } });
    }
    const { matched, response } = await rpc.handle(request, {
      prefix: '/rpc',
      context,
    });
    return matched ? response : new Response('Not Found', { status: 404 });
  },
});
await server.ready();
console.log(`Admin: ${server.url}admin`);
```

### 5. The admin page

The page asks for the token once, then shows the admin. Every call it makes carries the token and the organization.

```html index.html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Admin</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./web/main.tsx"></script>
  </body>
</html>
```

```tsx web/main.tsx
import '@latticecms/admin/admin.css';
import { Admin } from '@latticecms/admin';
import { type FormEvent, StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

// The organization the server made you a member of. A real app picks one.
const organization = 'acme';

function Page() {
  const [token, setToken] = useState(sessionStorage.getItem('token'));
  // Each call carries the token and the organization. A 401 asks again.
  const signedFetch = useMemo<typeof fetch>(
    () => async (input, init) => {
      const request = new Request(input, init);
      request.headers.set('authorization', `Bearer ${token}`);
      request.headers.set('x-organization-id', organization);
      const response = await fetch(request);
      if (response.status === 401) {
        sessionStorage.removeItem('token');
        setToken(null);
      }
      return response;
    },
    [token],
  );
  const signIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const given = String(new FormData(event.currentTarget).get('token'));
    sessionStorage.setItem('token', given);
    setToken(given);
  };
  if (token === null) {
    return (
      <form onSubmit={signIn}>
        <label>
          Token <input name="token" type="password" required />
        </label>
        <button type="submit">Sign in</button>
      </form>
    );
  }
  return <Admin fetch={signedFetch} catalogUrl="/catalog.json" basePath="/admin" />;
}

const root = document.getElementById('root');
if (root === null) throw new Error('index.html has no #root');
createRoot(root).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
```

```ts vite.config.ts
import { defineConfig } from 'vite';

// The admin page, built into dist/public/admin and served at /admin.
export default defineConfig({
  base: '/admin/',
  build: {
    outDir: 'dist/public/admin',
    emptyOutDir: true,
    rolldownOptions: {
      // React libraries mark modules "use client"; a browser bundle drops it.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
});
```

### 6. Run it

```bash
npm run build
```

```bash start
ADMIN_TOKEN=change-me npm start
```

Open the URL it prints, and sign in with the token, `change-me`. Create a company, then a contact: in the contact's form, search for the company by name and pick it. Edit the contact. Try to delete the company: the admin says its contacts still refer to it, and links to them. Delete the contact, then the company.

### Before production

This app is a first page. Replace these before anyone else uses it:

- **The store.** `MemoryStore` forgets everything on restart. Use `MongoStore` from [`@latticecms/store-mongo`](packages/store-mongo), and run data migrations with [`lattice migrate`](packages/cli#lattice-migrate).
- **Sign-in.** One fixed token is one user. Use `@hexok/auth`'s sessions with a login router, as the crm's [`/auth` router](examples/crm/src/servers/auth/router.ts) does. The edge stays the same: it authenticates through the same port.
- **Memberships.** The server seeds one. Trusted code writes real ones, as the crm's [`dev-user`](examples/crm/src/servers/scripts/dev-user.ts) script does.
- **The organization.** The page names one. Let the user pick, as the crm's [admin page](examples/crm/src/web/app.tsx) does with its switcher.
- **Access.** Companies and contacts are open to any member. Tighten each collection's access in `src/app.ts`; see [core's README](packages/core#access).

[`examples/crm`](examples/crm) is the same app grown up. The [`lattice` agent skill](packages/core/skills/lattice/SKILL.md) walks an agent through each next step.

## Working on this repo

```bash
npm install
npm run lint && npm run type-check && npm run test && npm run build
```
