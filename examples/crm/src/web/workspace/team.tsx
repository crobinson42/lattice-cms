import { createContext, type ReactNode, useContext } from 'react';
import type { Member } from '../resources/members/member.js';
import { ErrorState, Loading } from '../ui/states.js';

/** The organization's members, and the signed-in one among them. */
export type Team = {
  readonly members: readonly Member[];
  /** The signed-in member: their role decides what pages offer them. */
  readonly me: Member;
};

/** The team as the workspace reads it: there, still loading, or failed. */
export type TeamRead = {
  readonly team: Team | undefined;
  readonly failed: boolean;
  /** Reads the team and the signed-in member again. */
  readonly refresh: () => void;
};

export const TeamContext = createContext<TeamRead | null>(null);

/**
 * The team, read once by the workspace for every page: pages look members
 * up in it rather than read them again.
 */
export function useTeam(): TeamRead {
  const team = useContext(TeamContext);
  if (team === null) throw new Error('useTeam() outside the workspace');
  return team;
}

/**
 * Its children, once the team is there: only what needs the team waits
 * for it, and a failed read offers its own retry.
 */
export function TeamGate({
  children,
}: {
  readonly children: (team: Team) => ReactNode;
}) {
  const { team, failed, refresh } = useTeam();
  if (team !== undefined) return children(team);
  if (failed) {
    return (
      <ErrorState message="Your team could not be loaded." onRetry={refresh} />
    );
  }
  return <Loading />;
}
