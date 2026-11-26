import {
  BriefcaseIcon,
  Building2Icon,
  HouseIcon,
  ListChecksIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { type ReactNode, useMemo } from 'react';
import useSWR from 'swr';
import { Redirect } from 'wouter';
import { useApi } from '../api.js';
import type { Member } from '../resources/members/member.js';
import { useSignedIn } from '../signed-in.js';
import { OrganizationSwitcher } from '../ui/organization-switcher.js';
import { Shell } from '../ui/shell.js';
import { OverdueTasksBadge } from './overdue-tasks-badge.js';
import { TeamContext } from './team.js';
import { UserMenu } from './user-menu.js';

/** The app's sections, in the sidebar's order. A page adds itself here. */
const sections = [
  { href: '/', label: 'Home', icon: <HouseIcon /> },
  { href: '/companies', label: 'Companies', icon: <Building2Icon /> },
  { href: '/contacts', label: 'Contacts', icon: <UsersIcon /> },
  { href: '/deals', label: 'Deals', icon: <BriefcaseIcon /> },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: <ListChecksIcon />,
    badge: <OverdueTasksBadge />,
  },
  { href: '/team', label: 'Team', icon: <UsersRoundIcon /> },
];

/**
 * The app's pages for a member of an organization, in the shell. It reads
 * the signed-in member, for the user menu and their role, and the team
 * once, for pages to look members up in (useTeam). Nothing waits for the
 * team but what needs it (TeamGate). Support acts in no organization, so
 * the admin is its whole app.
 */
export function Workspace({ children }: { readonly children: ReactNode }) {
  const { userId, organization, signOut } = useSignedIn();
  const { swr } = useApi();
  // The signed-in member, on their own: the user menu and their role.
  const me = useSWR(
    swr.memberships.find.key({
      input: { where: { userId: { eq: userId } }, limit: 1 },
    }),
    swr.memberships.find.fetcher(),
  );
  // The whole team, every page of it: a member reads the memberships of
  // their own organization.
  const members = useSWR(['team'], async () => {
    const team: Member[] = [];
    let after: string | undefined;
    do {
      const page = await swr.memberships.find({
        sort: ['name'],
        limit: 100,
        ...(after === undefined ? {} : { after }),
      });
      team.push(...page.docs);
      after = page.next ?? undefined;
    } while (after !== undefined);
    return team;
  });
  const meDoc = me.data?.docs[0];
  const read = useMemo(
    () => ({
      team:
        members.data === undefined || meDoc === undefined
          ? undefined
          : { members: members.data, me: meDoc },
      failed: members.error !== undefined || me.error !== undefined,
      refresh: () => {
        void members.mutate();
        void me.mutate();
      },
    }),
    [members.data, members.error, members.mutate, meDoc, me.error, me.mutate],
  );
  if (organization === undefined) return <Redirect to="/admin" replace />;
  return (
    <Shell
      sections={sections}
      actions={
        <>
          <OrganizationSwitcher />
          <UserMenu member={meDoc} userId={userId} onSignOut={signOut} />
        </>
      }
    >
      <TeamContext value={read}>{children}</TeamContext>
    </Shell>
  );
}
