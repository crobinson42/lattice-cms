import { unscoped } from '@latticecms/core';
import type { Credentials } from '../../app/ports/auth/credentials.js';
import type { Role } from '../../domain/collections/memberships.js';
import type { CrmApp } from '../../servers/app.js';
import type { CrmSessions } from './sessions.js';

/**
 * For local development: finds the organization named `organization`, or
 * creates it, makes `userId` a member of it when it is not one yet, and
 * opens a session for it. Returns the token. It skips any password: that is
 * what login checks.
 */
export async function openDevSession(
  deps: {
    readonly crm: Pick<CrmApp, 'repos'>;
    readonly sessions: CrmSessions;
  },
  member: {
    readonly userId: string;
    /** The organization's name. */
    readonly organization: string;
    /** The role when the membership is new. Default `member`. */
    readonly role?: Role;
  },
): Promise<string> {
  const { memberships, organizations } = deps.crm.repos;
  const [found] = (
    await organizations.find(
      { where: { name: { eq: member.organization } }, limit: 1 },
      unscoped,
    )
  ).docs;
  const { id: organizationId } =
    found ??
    (await organizations.insert({ name: member.organization }, unscoped));
  const where = {
    userId: { eq: member.userId },
    organizationId: { eq: organizationId },
  };
  if ((await memberships.count(where, unscoped)) === 0) {
    await memberships.insert(
      {
        userId: member.userId,
        organizationId,
        ...(member.role === undefined ? {} : { role: member.role }),
      },
      unscoped,
    );
  }
  return deps.sessions.open({ userId: member.userId });
}

/**
 * For local development: sets the user's email and password (12 characters
 * or more), adds the membership, and opens a session. Returns the token.
 * There is no signup and no reset; this is how a user gets a password.
 */
export async function provisionDevUser(
  deps: {
    readonly crm: Pick<CrmApp, 'repos'>;
    readonly sessions: CrmSessions;
    readonly credentials: Credentials;
  },
  user: {
    readonly userId: string;
    readonly email: string;
    readonly password: string;
    /** The organization's name. */
    readonly organization: string;
    readonly role?: Role;
  },
): Promise<string> {
  await deps.credentials.set(
    { userId: user.userId, email: user.email },
    user.password,
  );
  return openDevSession(deps, {
    userId: user.userId,
    organization: user.organization,
    ...(user.role === undefined ? {} : { role: user.role }),
  });
}
