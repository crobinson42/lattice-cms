import { type ReactNode, useMemo } from 'react';
import useSWR, { SWRConfig } from 'swr';
import { readCatalog } from './catalog.js';
import { collectionsOf } from './collections.js';
import { LinkProvider } from './data.js';
import { DetailPage } from './detail-page.js';
import { IndexPage } from './index-page.js';
import { ListPage } from './list-page.js';
import { CollectionsProvider, useCollection } from './model.js';
import { refusalOf } from './refusal.js';
import { Link, RouterProvider, useRouter } from './router.js';
import { ErrorAlert, Loading, NotFound } from './states.js';

/** The catalog at `url`, read with the app's fetch, or a throw saying why not. */
async function loadCatalog(fetch: typeof globalThis.fetch, url: string) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`The catalog at ${url} answered ${response.status}.`);
  }
  const read = readCatalog(await response.json());
  if (!read.ok) {
    throw new Error(`The catalog at ${url} cannot be read. ${read.reason}`);
  }
  return read.catalog;
}

/** The page the route names. */
function Page() {
  const { route } = useRouter();
  const collection = useCollection(
    route.page === 'list' || route.page === 'detail'
      ? route.collection
      : undefined,
  );
  if (route.page === 'index') return <IndexPage />;
  if (route.page === 'not-found') return <NotFound what="No page here." />;
  if (collection === undefined) {
    return <NotFound what={`No collection "${route.collection}".`} />;
  }
  if (route.page === 'list') {
    return (
      <ListPage
        key={collection.slug}
        collection={collection}
        query={route.query}
      />
    );
  }
  return (
    <DetailPage
      key={`${collection.slug}/${route.id}`}
      collection={collection}
      id={route.id}
    />
  );
}

/** The pages, once the catalog has loaded. */
function Catalog({
  fetch,
  catalogUrl,
}: {
  readonly fetch: typeof globalThis.fetch;
  readonly catalogUrl: string;
}) {
  // The catalog changes only with a deploy, so it is read once per mount.
  const { data, error } = useSWR(
    ['lattice-admin:catalog', catalogUrl],
    ([, url]) => loadCatalog(fetch, url),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
    },
  );
  // Once per catalog, not per render: pages keep the same field objects.
  const collections = useMemo(
    () => (data === undefined ? [] : collectionsOf(data)),
    [data],
  );
  if (error !== undefined) {
    return (
      <ErrorAlert
        title="The admin cannot start"
        message={refusalOf(error).message}
      />
    );
  }
  if (data === undefined) return <Loading />;
  return (
    <CollectionsProvider collections={collections}>
      <LinkProvider prefix={data.prefix} fetch={fetch}>
        <Page />
      </LinkProvider>
    </CollectionsProvider>
  );
}

function TopBar({ header }: { readonly header: ReactNode }) {
  const { href } = useRouter();
  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link className="font-semibold" href={href()}>
        Admin
      </Link>
      <div>{header}</div>
    </header>
  );
}

/**
 * Each mount has its own cache. Data refetches when the window regains
 * focus; a refusal is not retried, since it would answer the same again.
 * A list keeps its rows on screen while the next page or sort loads.
 */
const swrConfig = {
  provider: () => new Map(),
  revalidateOnFocus: true,
  shouldRetryOnError: false,
  keepPreviousData: true,
};

/**
 * An admin for a Lattice app, rendered from the catalog the app serves.
 * The app supplies `fetch`, which adds its session and organization to each
 * request, and mounts it on a catch-all route under `basePath`. Key it by
 * organization, so a switch remounts it with an empty cache.
 */
export function Admin({
  fetch,
  catalogUrl,
  basePath,
  header,
}: {
  /** Calls the app's server as the signed-in user: the catalog and every procedure. */
  readonly fetch: typeof globalThis.fetch;
  /** Where the app serves `catalog(contract)` as JSON. */
  readonly catalogUrl: string;
  /** The path the admin is mounted under, such as `/admin`. */
  readonly basePath: string;
  /** The app's part of the top bar, such as an organization switcher. */
  readonly header?: ReactNode;
}) {
  return (
    <SWRConfig value={swrConfig}>
      <RouterProvider basePath={basePath}>
        <div className="min-h-screen bg-background text-foreground">
          <TopBar header={header} />
          <main className="mx-auto max-w-6xl p-6">
            <Catalog fetch={fetch} catalogUrl={catalogUrl} />
          </main>
        </div>
      </RouterProvider>
    </SWRConfig>
  );
}
