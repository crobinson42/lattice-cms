import { bearerToken } from '@hexok/auth';
import type { Logger } from '@hexok/logger';
import { type CallContext, LatticeError, unscoped } from '@latticecms/core';
import type { Actor } from '../../app/use-cases/context.js';
import type { HttpDeps } from './handler.js';
import { organizationHeader } from './headers.js';

// Who is calling: the session a request's token names, and the actor it
// acts as. Every edge (/rpc, /mcp, /auth and the API's documents) checks
// the caller here, with the same log lines and refusals.

/** The request id a request names, or a new one. */
export function requestIdOf(request: Request): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID();
}

/** Where a call came in, as its refusal lines name it. */
export type Edge = 'rpc' | 'mcp' | 'auth' | 'openapi' | 'catalog';

/**
 * The user the request's bearer token names, with that token, or undefined
 * once the refusal is logged. A token must name a live session.
 */
export async function signedIn(
  deps: HttpDeps,
  request: Request,
  logger: Logger,
  edge: Edge,
): Promise<{ readonly userId: string; readonly token: string } | undefined> {
  const refused = (reason: string) => {
    logger.info(edge, { outcome: 'refused', code: 'UNAUTHORIZED', reason });
    return undefined;
  };
  const token = bearerToken(request.headers.get('authorization'));
  // The reason hexok's sessions give for no token.
  if (token === undefined) return refused('missing');
  const found = await deps.sessions.authenticate(token);
  if (!found.ok) return refused(found.code);
  return { userId: found.value.userId, token };
}

/**
 * The call context of a signed-in user. A support user acts as support;
 * anyone else must be a member of the organization the header names. Each
 * check runs on every call, so a switched or revoked membership takes
 * effect on the next one. Only then does the actor exist, so `tenantOf`
 * reads a checked organization. Every edge builds its context here.
 */
export function actorContext(deps: HttpDeps) {
  const memberships = deps.crm.repos.memberships;
  return async (
    userId: string,
    request: Request,
    logger: Logger,
    edge: Edge,
  ): Promise<CallContext<Actor>> => {
    if (deps.support.has(userId)) {
      return { actor: { userId, support: true }, logger };
    }
    const organizationId = request.headers.get(organizationHeader);
    // Trusted edge code: it decides who the actor is, so no actor's access
    // applies yet. A missing organization and one that does not exist look
    // the same as one the user is not a member of.
    const [member] =
      organizationId === null
        ? []
        : (
            await memberships.find(
              {
                where: {
                  userId: { eq: userId },
                  organizationId: { eq: organizationId },
                },
                limit: 1,
              },
              unscoped,
            )
          ).docs;
    if (organizationId === null || member === undefined) {
      logger.info(edge, {
        outcome: 'refused',
        code: 'FORBIDDEN',
        reason: organizationId === null ? 'no-organization' : 'not-a-member',
      });
      throw deps.crm.clientError(LatticeError.FORBIDDEN());
    }
    return { actor: { userId, organizationId, role: member.role }, logger };
  };
}
