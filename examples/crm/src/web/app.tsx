import { Admin } from '@latticecms/admin';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { authClient } from './auth.js';
import { session, sessionFetch } from './session.js';
import { SignIn } from './sign-in.js';

type Organization = { readonly id: string; readonly name: string };

/** The organization switcher and sign-out, in the admin's top bar. */
function Header({
  organizations,
  picked,
  onPick,
  onSignOut,
}: {
  readonly organizations: readonly Organization[];
  readonly picked: string;
  readonly onPick: (id: string) => void;
  readonly onSignOut: () => void;
}) {
  return (
    <div className="crm-header">
      <select
        aria-label="Organization"
        value={picked}
        onChange={(event) => onPick(event.target.value)}
      >
        {organizations.map(({ id, name }) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
      <button type="button" onClick={onSignOut}>
        Sign out
      </button>
    </div>
  );
}

/**
 * The admin for a signed-in user, in the organization they pick. Support
 * acts in none, so it gets the admin with no switcher.
 */
function SignedIn({
  token,
  onSignedOut,
}: {
  readonly token: string;
  readonly onSignedOut: () => void;
}) {
  const [organizations, setOrganizations] = useState<readonly Organization[]>();
  const [failed, setFailed] = useState(false);
  const [picked, setPicked] = useState(session.organization());
  const auth = useMemo(
    () => authClient(sessionFetch(token, undefined, onSignedOut)),
    [token, onSignedOut],
  );
  // A 401 signs out through the session's fetch. Anything else, such as a
  // dropped connection, can be tried again.
  const load = useCallback(() => {
    setFailed(false);
    auth.organizations({}).then(setOrganizations, () => setFailed(true));
  }, [auth]);
  useEffect(load, [load]);
  const current =
    organizations?.find(({ id }) => id === picked) ?? organizations?.[0];
  const fetch = useMemo(
    () => sessionFetch(token, current?.id, onSignedOut),
    [token, current, onSignedOut],
  );
  if (failed) {
    return (
      <p role="alert" className="crm-error">
        Your organizations could not be loaded.{' '}
        <button type="button" onClick={load}>
          Try again
        </button>
      </p>
    );
  }
  if (organizations === undefined) return null;
  const signOut = () => {
    void auth.logout({}).finally(onSignedOut);
  };
  return (
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
  );
}

/** The crm's admin page: sign-in, then the admin. */
export function App() {
  const [token, setToken] = useState(session.token());
  const signedOut = useCallback(() => {
    session.clear();
    setToken(null);
  }, []);
  if (token === null) {
    return (
      <SignIn
        onSignedIn={(next) => {
          session.signIn(next);
          setToken(next);
        }}
      />
    );
  }
  return <SignedIn token={token} onSignedOut={signedOut} />;
}
