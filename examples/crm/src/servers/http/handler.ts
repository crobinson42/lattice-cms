import { bearerToken } from '@hexok/auth';
import type { Logger } from '@hexok/logger';
import { LatticeError } from '@latticecms/core';
import { FetchHandler } from '@ts-pf/server-http';
import type { Login } from '../../app/use-cases/auth/login.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import type { CrmApp } from '../app.js';
import { type AuthRpcCtx, createAuthRouter } from '../auth/router.js';
import { isApiPath } from './api-paths.js';
import { actorContext, requestIdOf, signedIn } from './caller.js';
import { signedInDocuments } from './documents.js';
import { mcpEdge } from './mcp-edge.js';
import { webPage } from './page.js';

/** What the edge needs: the app, login, its sessions, and who is support. */
export type HttpDeps = {
  readonly crm: Pick<CrmApp, 'app' | 'clientError' | 'onError' | 'repos'>;
  readonly login: Login;
  readonly sessions: CrmSessions;
  /** User ids that act as support, from `CRM_SUPPORT_USER_IDS`. */
  readonly support: ReadonlySet<string>;
  readonly logger: Logger;
  /** The built web page's directory, served at `/`. */
  readonly web: URL;
};

/**
 * The server as one fetch function, routing each request by its path:
 * `/health`; the API's OpenAPI document and catalog for a signed-in user;
 * the API as MCP tools at `/mcp`; the API at `/rpc`; sign-in, sign-out and
 * the caller's organizations at `/auth`; and, for any other GET, the web
 * page, whose client routes include the admin at `/admin`. srvx, Bun,
 * Deno, Hono or a test calls it with a `Request`.
 */
export function createHttpHandler(
  deps: HttpDeps,
): (request: Request) => Promise<Response> {
  // Logs what no family logged: a family logs its own unexpected errors.
  const onError = deps.crm.onError(deps.logger);
  const api = new FetchHandler(deps.crm.app, { onError });
  const auth = new FetchHandler(createAuthRouter(deps), { onError });
  const contextOf = actorContext(deps);
  const apiContext = async (request: Request) => {
    const logger = deps.logger.child({ requestId: requestIdOf(request) });
    const user = await signedIn(deps, request, logger, 'rpc');
    if (user === undefined)
      throw deps.crm.clientError(LatticeError.UNAUTHORIZED());
    return contextOf(user.userId, request, logger, 'rpc');
  };
  const authContext = (request: Request): AuthRpcCtx => {
    const logger = deps.logger.child({ requestId: requestIdOf(request) });
    return {
      logger,
      token: bearerToken(request.headers.get('authorization')),
      // The same check, log line and refusal as /rpc.
      async signedIn() {
        const user = await signedIn(deps, request, logger, 'auth');
        if (user === undefined)
          throw deps.crm.clientError(LatticeError.UNAUTHORIZED());
        return user.userId;
      },
    };
  };
  const documents = signedInDocuments(deps);
  const mcp = mcpEdge(deps, onError);
  const page = webPage(deps.web);

  return async (request) => {
    const { method } = request;
    const { pathname } = new URL(request.url);
    if (method === 'GET' && pathname === '/health') {
      return Response.json({ ok: true });
    }
    if (method === 'GET' && pathname === '/openapi.json') {
      return documents.openapi(request);
    }
    if (method === 'GET' && pathname === '/catalog.json') {
      return documents.catalog(request);
    }
    if (pathname === '/mcp') return mcp(request);
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
    if ((method === 'GET' || method === 'HEAD') && !isApiPath(pathname)) {
      return page(request);
    }
    return new Response('Not Found', { status: 404 });
  };
}
