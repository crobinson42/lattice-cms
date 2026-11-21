import type { Logger } from '@hexok/logger';
import type { CallContext } from '@latticecms/core';
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import type { Actor } from '../../app/use-cases/context.js';
import type { CrmApp } from '../app.js';

/**
 * The dev headers that name the caller: the user, their organization, and
 * `true` for support staff. Real auth arrives in Phase 2.
 */
export const devUserHeader = 'x-dev-user';
export const devOrgHeader = 'x-dev-org';
export const devSupportHeader = 'x-dev-support';

/**
 * The call context for one request: the actor from the dev headers, and a
 * logger for this request. Lattice adds the call's access. A request
 * without a user or an organization is refused here: the context type says
 * the actor is valid, so the edge cannot pass "no actor" to the family
 * guard. An invalid value still reaches the guard, which answers
 * UNAUTHORIZED.
 */
function contextOf(root: Logger) {
  return (request: Request): CallContext<Actor> => {
    const logger = root.child({
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
    });
    const { headers } = request;
    const userId = headers.get(devUserHeader);
    const organizationId = headers.get(devOrgHeader);
    if (userId === null || organizationId === null) {
      logger.info('rpc', { outcome: 'refused', code: 'UNAUTHORIZED' });
      throw new PFError({
        code: 'UNAUTHORIZED',
        status: 401,
        message: `Send ${devUserHeader} and ${devOrgHeader}`,
      });
    }
    const support = headers.get(devSupportHeader) === 'true';
    return { actor: { userId, organizationId, support }, logger };
  };
}

/**
 * The API at `/rpc` as one fetch function. srvx, Bun, Deno, Hono or a test
 * calls it with a `Request`.
 */
export function createHttpHandler(
  crm: Pick<CrmApp, 'app' | 'onError'>,
  options: { logger: Logger },
): (request: Request) => Promise<Response> {
  // Logs what no family logged: a family logs its own unexpected errors.
  const handler = new FetchHandler(crm.app, {
    onError: crm.onError(options.logger),
  });
  const context = contextOf(options.logger);
  return async (request) => {
    const result = await handler.handle(request, { prefix: '/rpc', context });
    if (result.matched) return result.response;
    return new Response('Not Found', { status: 404 });
  };
}
