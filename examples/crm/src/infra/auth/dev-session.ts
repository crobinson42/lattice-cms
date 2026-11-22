import { unscoped } from '@latticecms/core';
import type { Credentials } from '../../app/ports/auth/credentials.js';
import type { Role } from '../../domain/collections/memberships.js';
import type { CrmApp } from '../../servers/app.js';
import type { CrmSessions } from './sessions.js';

/**
 * For local development: makes `userId` a member of `organizationId` when
 * it is not one yet, and opens a session for it. Returns the token. It
 * skips any password: that is what login checks.
 */
export async function openDevSession(
  deps: {
    readonly crm: Pick<CrmApp, 'repos'>;
    readonly sessions: CrmSessions;
  },
  member: {
    readonly userId: string;
    readonly organizationId: string;
    /** The role when the membership is new. Default `member`. */
    readonly role?: Role;
  },
): Promise<string> {
  const memberships = deps.crm.repos.memberships;
  const where = {
    userId: { eq: member.userId },
    organizationId: { eq: member.organizationId },
  };
  if ((await memberships.count(where, unscoped)) === 0) {
    await memberships.insert(member, unscoped);
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
    readonly organizationId: string;
    readonly role?: Role;
  },
): Promise<string> {
  await deps.credentials.set(
    { userId: user.userId, email: user.email },
    user.password,
  );
  return openDevSession(deps, {
    userId: user.userId,
    organizationId: user.organizationId,
    ...(user.role === undefined ? {} : { role: user.role }),
  });
}
