import { bearerToken } from '@hexok/auth';
import type { Logger } from '@hexok/logger';
import { type CallContext, LatticeError, unscoped } from '@latticecms/core';
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import type { Login } from '../../app/use-cases/auth/login.js';
import type { Actor } from '../../app/use-cases/context.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import type { CrmApp } from '../app.js';
import { createAuthRouter } from '../auth/router.js';

/** The header that names the organization a call acts in. */
export const organizationHeader = 'x-organization-id';

/** What the edge needs: the app, login, its sessions, and who is support. */
export type HttpDeps = {
  readonly crm: Pick<CrmApp, 'app' | 'onError' | 'repos'>;
  readonly login: Login;
  readonly sessions: CrmSessions;
  /** User ids that act as support, from `CRM_SUPPORT_USER_IDS`. */
  readonly support: ReadonlySet<string>;
  readonly logger: Logger;
};

/**
 * A refusal at the edge, with Lattice's code, status and message, so a
 * client handles it as it would the same refusal from a procedure. Every
 * reason gets the same body: the reason is logged, never sent.
 */
function refusal(code: 'UNAUTHORIZED' | 'FORBIDDEN'): PFError {
  const error =
    code === 'UNAUTHORIZED'
      ? LatticeError.UNAUTHORIZED()
      : LatticeError.FORBIDDEN();
  return new PFError({
    code,
    status: code === 'UNAUTHORIZED' ? 401 : 403,
    message: error.message,
  });
}

/** A logger for one request, tagged with its id. */
function requestLogger(root: Logger, request: Request): Logger {
  return root.child({
    requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
  });
}

/**
 * The call context for one request. The bearer token must name a live
 * session; a support user acts as support; anyone else must be a member of
 * the organization the header names. Each check runs on every request, so
 * a switched or revoked membership takes effect on the next one. Only then
 * does the actor exist, so `tenantOf` reads a checked organization.
 */
function contextOf(deps: HttpDeps) {
  const memberships = deps.crm.repos.memberships;
  return async (request: Request): Promise<CallContext<Actor>> => {
    const logger = requestLogger(deps.logger, request);
    const found = await deps.sessions.authenticate(
      bearerToken(request.headers.get('authorization')),
    );
    if (!found.ok) {
      logger.info('rpc', {
        outcome: 'refused',
        code: 'UNAUTHORIZED',
        reason: found.code,
      });
      throw refusal('UNAUTHORIZED');
    }
    const { userId } = found.value;
    if (deps.support.has(userId)) {
      return { actor: { userId, support: true }, logger };
    }
    const organizationId = request.headers.get(organizationHeader);
    // Trusted edge code: it decides who the actor is, so no actor's access
    // applies yet. A missing organization and one that does not exist look
    // the same as one the user is not a member of.
    const member =
      organizationId !== null &&
      (await memberships.count(
        {
          userId: { eq: userId },
          organizationId: { eq: organizationId },
        },
        unscoped,
      )) > 0;
    if (organizationId === null || !member) {
      logger.info('rpc', {
        outcome: 'refused',
        code: 'FORBIDDEN',
        reason: organizationId === null ? 'no-organization' : 'not-a-member',
      });
      throw refusal('FORBIDDEN');
    }
    return { actor: { userId, organizationId }, logger };
  };
}

/**
 * The server as one fetch function: the API at `/rpc`, sign-in and
 * sign-out at `/auth`, and `/health`. srvx, Bun, Deno, Hono or a test calls
 * it with a `Request`.
 */
export function createHttpHandler(
  deps: HttpDeps,
): (request: Request) => Promise<Response> {
  // Logs what no family logged: a family logs its own unexpected errors.
  const onError = deps.crm.onError(deps.logger);
  const api = new FetchHandler(deps.crm.app, { onError });
  const auth = new FetchHandler(createAuthRouter(deps), { onError });
  const apiContext = contextOf(deps);
  const authContext = (request: Request) => ({
    logger: requestLogger(deps.logger, request),
    token: bearerToken(request.headers.get('authorization')),
  });
  return async (request) => {
    if (
      request.method === 'GET' &&
      new URL(request.url).pathname === '/health'
    ) {
      return Response.json({ ok: true });
    }
    const rpc = await api.handle(request, {
      prefix: '/rpc',
      context: apiContext,
    });
    if (rpc.matched) return rpc.response;
    const signIn = await auth.handle(request, {
      prefix: '/auth',
      context: authContext,
    });
    if (signIn.matched) return signIn.response;
    return new Response('Not Found', { status: 404 });
  };
}
