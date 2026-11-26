import { Building2Icon } from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import useSWR from 'swr';
import { Redirect } from 'wouter';
import { useApi } from '../api.js';
import { useSession } from '../session.js';
import { useSignedIn } from '../signed-in.js';
import { OrganizationSwitcher } from '../ui/organization-switcher.js';
import { Shell } from '../ui/shell.js';
import { UserMenu } from './user-menu.js';

/** The app's sections, in the sidebar's order. A page adds itself here. */
const sections = [
  { href: '/companies', label: 'Companies', icon: <Building2Icon /> },
];

/**
 * The app's pages for a member of an organization, in the shell: it reads
 * the signed-in member for the user menu, and focuses the page's heading
 * when the user has just signed in. Support acts in no organization, so
 * the admin is its whole app.
 */
export function Workspace({ children }: { readonly children: ReactNode }) {
  const { userId, organization, signOut } = useSignedIn();
  const { swr } = useApi();
  const { takeArrival } = useSession();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (takeArrival()) heading.current?.focus();
  }, [takeArrival]);
  const { data } = useSWR(
    swr.memberships.find.key({
      input: { where: { userId: { eq: userId } }, limit: 1 },
    }),
    swr.memberships.find.fetcher(),
  );
  if (organization === undefined) return <Redirect to="/admin" replace />;
  return (
    <Shell
      sections={sections}
      headingRef={heading}
      actions={
        <>
          <OrganizationSwitcher />
          <UserMenu
            member={data?.docs[0]}
            userId={userId}
            onSignOut={signOut}
          />
        </>
      }
    >
      {children}
    </Shell>
  );
}
