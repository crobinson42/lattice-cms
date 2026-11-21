import type { Logger } from '@hexok/logger';
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import type { AppCtx } from '../../app/use-cases/context.js';
import type { CrmApp } from '../app.js';

/** The dev header that names the caller. Real auth arrives in Phase 2. */
export const devUserHeader = 'x-dev-user';

/**
 * The call context for one request: the actor from the dev header, and a
 * logger for this request. A request without the header is refused here:
 * the context type says the actor is valid, so the edge cannot pass "no
 * actor" to the family guard. A header with an invalid id still reaches the
 * guard, which answers UNAUTHORIZED.
 */
function contextOf(root: Logger) {
  return (request: Request): AppCtx => {
    const logger = root.child({
      requestId: request.headers.get('x-request-id') ?? crypto.randomUUID(),
    });
    const userId = request.headers.get(devUserHeader);
    if (userId === null) {
      logger.info('rpc', { outcome: 'refused', code: 'UNAUTHORIZED' });
      throw new PFError({
        code: 'UNAUTHORIZED',
        status: 401,
        message: `Send ${devUserHeader}`,
      });
    }
    return { actor: { userId }, logger };
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
