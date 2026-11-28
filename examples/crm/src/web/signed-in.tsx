import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Redirect, useLocation, useSearch } from 'wouter';
import { ApiProvider } from './api.js';
import { authClient, type Organization, type Signed } from './auth.js';
import { sessionFetch, stored, useSession } from './session.js';
import { ErrorState, Loading } from './ui/states.js';

/** What every signed-in page reads: the user, the organization, sign-out. */
type SignedInState = {
  readonly userId: string;
  readonly organizations: readonly Organization[];
  /** The organization the session acts in. Support acts in none. */
  readonly organization: Organization | undefined;
  readonly pick: (organizationId: string) => void;
  /** The organization switcher, focused again after a switch remounts it. */
  readonly switcherRef: RefObject<HTMLSelectElement | null>;
  /** Ends the session here at once, and tells the server. */
  readonly signOut: () => void;
};

const SignedInContext = createContext<SignedInState | null>(null);

export function useSignedIn(): SignedInState {
  const state = useContext(SignedInContext);
  if (state === null) throw new Error('useSignedIn() outside <SignedIn>');
  return state;
}

/**
 * Its children for a signed-in user, with the API in the picked
 * organization. Anyone else goes to /sign-in, and comes back after.
 */
export function SignedIn({ children }: { readonly children: ReactNode }) {
  const { signed, signOut } = useSession();
  const [location] = useLocation();
  const search = useSearch();
  if (signed === null) {
    const next = encodeURIComponent(location + (search ? `?${search}` : ''));
    return <Redirect to={`/sign-in?next=${next}`} replace />;
  }
  // A new session starts over: its own organizations, and its own pick.
  return (
    <Organizations key={signed.token} signed={signed} onSignedOut={signOut}>
      {children}
    </Organizations>
  );
}

function Organizations({
  signed,
  onSignedOut,
  children,
}: {
  readonly signed: Signed;
  readonly onSignedOut: () => void;
  readonly children: ReactNode;
}) {
  const [organizations, setOrganizations] = useState<readonly Organization[]>();
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState(stored.organization);
  const auth = useMemo(
    () => authClient(sessionFetch(signed.token, undefined, onSignedOut)),
    [signed.token, onSignedOut],
  );
  // A 401 signs out through the session's fetch. Anything else, such as a
  // dropped connection, can be tried again.
  const load = useCallback(() => {
    setFailed(false);
    auth.organizations({}).then(setOrganizations, () => setFailed(true));
  }, [auth]);
  useEffect(load, [load]);
  const organization =
    organizations?.find(({ id }) => id === picked) ?? organizations?.[0];
  const fetch = useMemo(
    () => sessionFetch(signed.token, organization?.id, onSignedOut),
    [signed.token, organization, onSignedOut],
  );

  // A switch remounts every page, the switcher with them; focus goes back
  // to it once the new organization's pages are in.
  const switcherRef = useRef<HTMLSelectElement>(null);
  const switched = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each switch.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    switcherRef.current?.focus();
  }, [organization?.id]);

  const state = useMemo(
    (): SignedInState | undefined =>
      organizations === undefined
        ? undefined
        : {
            userId: signed.userId,
            organizations,
            organization,
            pick: (id) => {
              stored.pick(id);
              switched.current = true;
              setPicked(id);
            },
            switcherRef,
            // Signing out never waits on the server: a hung or failed
            // logout still ends the session here, and the server's own
            // session ends when it idles out.
            signOut: () => {
              onSignedOut();
              auth.logout({}).catch(() => undefined);
            },
          },
    [signed.userId, organizations, organization, auth, onSignedOut],
  );
  if (failed) {
    return (
      <ErrorState
        message="Your organizations could not be loaded."
        onRetry={load}
      />
    );
  }
  if (state === undefined) return <Loading />;
  return (
    <SignedInContext value={state}>
      <ApiProvider fetch={fetch} organizationId={organization?.id}>
        {children}
      </ApiProvider>
    </SignedInContext>
  );
}
