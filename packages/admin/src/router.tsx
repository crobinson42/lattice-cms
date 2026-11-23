import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useMemo,
  useSyncExternalStore,
} from 'react';

/** A page of the admin, from the URL under its base path. */
export type Route =
  | { readonly page: 'index' }
  | {
      readonly page: 'list';
      readonly collection: string;
      /** The list's own state: its filters, sort and pages. */
      readonly query: URLSearchParams;
    }
  | {
      readonly page: 'detail';
      readonly collection: string;
      readonly id: string;
    }
  | { readonly page: 'not-found' };

type Router = {
  readonly route: Route;
  /** The href of a page: the base path, then each segment, encoded. */
  readonly href: (...segments: string[]) => string;
  readonly navigate: (href: string) => void;
};

const RouterContext = createContext<Router | undefined>(undefined);

function trimmed(basePath: string): string {
  return basePath.replace(/\/+$/, '');
}

function decoded(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

/** The route a URL's path and query show, under `basePath`. */
export function routeOf(basePath: string, url: string): Route {
  const { pathname, searchParams } = new URL(url, 'http://admin.invalid');
  const base = trimmed(basePath);
  if (pathname !== base && !pathname.startsWith(`${base}/`)) {
    return { page: 'not-found' };
  }
  const segments = pathname
    .slice(base.length)
    .split('/')
    .filter((segment) => segment !== '')
    .map(decoded);
  // A malformed escape, such as `%E0%A4`, names no page.
  if (segments.some((segment) => segment === undefined)) {
    return { page: 'not-found' };
  }
  const [collection, id, ...rest] = segments;
  if (collection === undefined) return { page: 'index' };
  if (id === undefined)
    return { page: 'list', collection, query: searchParams };
  if (rest.length === 0) return { page: 'detail', collection, id };
  return { page: 'not-found' };
}

// The admin's own navigations. The browser reports back and forward as
// popstate; a pushState reports nothing, so navigate tells these listeners.
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

function currentUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function navigate(href: string): void {
  window.history.pushState(null, '', href);
  for (const listener of listeners) listener();
}

/**
 * The admin's router: the History API, under the app's base path. On a
 * server there is no URL, so the index renders until the browser takes over.
 */
export function RouterProvider({
  basePath,
  children,
}: {
  readonly basePath: string;
  readonly children: ReactNode;
}) {
  const url = useSyncExternalStore(subscribe, currentUrl, () => basePath);
  const router = useMemo<Router>(
    () => ({
      route: routeOf(basePath, url),
      href: (...segments) =>
        [trimmed(basePath), ...segments.map(encodeURIComponent)].join('/') ||
        '/',
      navigate,
    }),
    [basePath, url],
  );
  return <RouterContext value={router}>{children}</RouterContext>;
}

export function useRouter(): Router {
  const router = useContext(RouterContext);
  if (router === undefined) {
    throw new Error('Lattice admin: useRouter outside <Admin>');
  }
  return router;
}

/** A modified or middle click opens a new tab, as a plain link does. */
function opensElsewhere(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/** A real `<a href>` that navigates inside the admin on a plain click. */
export function Link({
  href,
  onClick,
  ...props
}: ComponentProps<'a'> & { readonly href: string }) {
  const router = useRouter();
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || opensElsewhere(event)) return;
        event.preventDefault();
        router.navigate(href);
      }}
    />
  );
}
