import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
// headers.ts holds only the header's name, so this imports no server code.
import { organizationHeader } from '../servers/http/headers.js';
import type { Signed } from './auth.js';

// The session lives for the tab: a reload keeps it, a new tab signs in.
const tokenKey = 'crm.token';
const userKey = 'crm.user';
const organizationKey = 'crm.organization';

/** The session in sessionStorage. */
export const stored = {
  signed: (): Signed | null => {
    const token = sessionStorage.getItem(tokenKey);
    const userId = sessionStorage.getItem(userKey);
    return token === null || userId === null ? null : { token, userId };
  },
  organization: () => sessionStorage.getItem(organizationKey),
  /** A new session forgets the last one, its organization too. */
  signIn: ({ token, userId }: Signed) => {
    sessionStorage.clear();
    sessionStorage.setItem(tokenKey, token);
    sessionStorage.setItem(userKey, userId);
  },
  pick: (organizationId: string) =>
    sessionStorage.setItem(organizationKey, organizationId),
  clear: () => sessionStorage.clear(),
};

/**
 * The fetch every client uses: it adds the session token and, once one is
 * picked, the organization. A 401 means this session ended. It signs out
 * only while this session is still the tab's: a late answer to a call made
 * before sign-out must not end the next user's session.
 */
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
    if (response.status === 401 && stored.signed()?.token === token) {
      onUnauthorized();
    }
    return response;
  };
}

/**
 * Where sign-in goes after: `next`, when it is a page of this site, with
 * its search and hash. Anything else, such as another origin, goes to `/`.
 */
export function nextPath(next: string | null, origin: string): string {
  if (next === null) return '/';
  const url = URL.parse(next, origin);
  return url?.origin === origin ? url.pathname + url.search + url.hash : '/';
}

/** Who is signed in, or null, and how to sign in or out here. */
type Session = {
  readonly signed: Signed | null;
  readonly signIn: (signed: Signed) => void;
  /** Ends the session here. The server is told by whoever calls it. */
  readonly signOut: () => void;
};

const SessionContext = createContext<Session | null>(null);

/** The tab's session, from sessionStorage. */
export function SessionProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [signed, setSigned] = useState(stored.signed);
  const signIn = useCallback((next: Signed) => {
    stored.signIn(next);
    setSigned(next);
  }, []);
  const signOut = useCallback(() => {
    stored.clear();
    setSigned(null);
  }, []);
  const value = useMemo(
    () => ({ signed, signIn, signOut }),
    [signed, signIn, signOut],
  );
  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (session === null)
    throw new Error('useSession() outside <SessionProvider>');
  return session;
}
