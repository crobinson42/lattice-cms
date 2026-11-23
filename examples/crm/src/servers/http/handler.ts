import { bearerToken } from '@hexok/auth';
import type { Logger } from '@hexok/logger';
import { type CallContext, LatticeError, unscoped } from '@latticecms/core';
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
} from '@modelcontextprotocol/server';
import { bindTools } from '@ts-pf/mcp';
import { createMcpFactory } from '@ts-pf/mcp/sdk';
import { PFError } from '@ts-pf/protocol';
import { FetchHandler } from '@ts-pf/server-http';
import type { Login } from '../../app/use-cases/auth/login.js';
import type { Actor } from '../../app/use-cases/context.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import type { CrmApp } from '../app.js';
import { type AuthRpcCtx, createAuthRouter } from '../auth/router.js';
import { crmTools } from '../mcp/toolset.js';
import { catalogDocument } from '../rpc/catalog.js';
import { openapiDocument } from '../rpc/openapi.js';

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

/** The request id a request names, or a new one. */
function requestIdOf(request: Request): string {
  return request.headers.get('x-request-id') ?? crypto.randomUUID();
}

/** Where a call came in, as its refusal lines name it. */
type Edge = 'rpc' | 'mcp' | 'auth' | 'openapi' | 'catalog';

/**
 * The user the request's bearer token names, with that token, or undefined
 * once the refusal is logged. A token must name a live session.
 */
async function signedIn(
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
function actorContext(deps: HttpDeps) {
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
      throw refusal('FORBIDDEN');
    }
    return { actor: { userId, organizationId, role: member.role }, logger };
  };
}

/**
 * MCP at `/mcp`: every procedure is a tool, run in process with the same
 * guards, masking and spans as `/rpc`. The edge checks the session before
 * the MCP SDK sees the request, so a missing or dead token is a `401`
 * challenge, not a tool error. The user and request id ride to `context`
 * in `authInfo`, the one channel the SDK passes through; the organization
 * header is read there, per call, as on `/rpc`.
 */
function mcpEdge(deps: HttpDeps, onError: (error: unknown) => void) {
  const contextOf = actorContext(deps);
  const tools = bindTools(crmTools, {
    app: deps.crm.app,
    onError,
    async context(info) {
      const userId = info.authInfo?.extra?.userId;
      const requestId = info.authInfo?.extra?.requestId;
      const request = info.requestInfo;
      // The edge sets all three before the SDK runs: this is a bug guard.
      if (
        typeof userId !== 'string' ||
        typeof requestId !== 'string' ||
        request === undefined
      ) {
        throw refusal('UNAUTHORIZED');
      }
      return contextOf(
        userId,
        request,
        deps.logger.child({ requestId }),
        'mcp',
      );
    },
  });
  const handler = createMcpHandler(
    createMcpFactory(tools, { name: 'crm', version: '0.0.0' }),
  );
  return async (request: Request): Promise<Response> => {
    const requestId = requestIdOf(request);
    const user = await signedIn(
      deps,
      request,
      deps.logger.child({ requestId }),
      'mcp',
    );
    if (user === undefined) {
      return bearerAuthChallengeResponse(
        new OAuthError(
          OAuthErrorCode.InvalidToken,
          LatticeError.UNAUTHORIZED().message,
        ),
      );
    }
    return handler.fetch(request, {
      authInfo: {
        token: user.token,
        // A crm session, not an OAuth client: there is no client id.
        clientId: '',
        scopes: [],
        extra: { userId: user.userId, requestId },
      },
    });
  };
}

/**
 * The server as one fetch function: the API at `/rpc`, the same API as MCP
 * tools at `/mcp`, its OpenAPI document at `/openapi.json` and its catalog
 * at `/catalog.json` for a signed-in user, sign-in, sign-out and the
 * caller's organizations at `/auth`, and `/health`. srvx, Bun, Deno,
 * Hono or a test calls it with a `Request`.
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
    if (user === undefined) throw refusal('UNAUTHORIZED');
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
        if (user === undefined) throw refusal('UNAUTHORIZED');
        return user.userId;
      },
    };
  };
  const mcp = mcpEdge(deps, onError);
  // Built on the first request and kept: the contract does not change
  // while serving.
  let openapi: ReturnType<typeof openapiDocument> | undefined;
  let catalog: ReturnType<typeof catalogDocument> | undefined;
  /**
   * A document about the API, for signed-in users only: its schemas say
   * which fields are masked. Any of them, so no organization is needed.
   */
  const forSignedIn = async (
    request: Request,
    edge: 'openapi' | 'catalog',
    document: () => unknown,
  ): Promise<Response> => {
    const logger = deps.logger.child({ requestId: requestIdOf(request) });
    if ((await signedIn(deps, request, logger, edge)) === undefined) {
      // The body /rpc sends for the same refusal.
      return Response.json(
        { ok: false, error: refusal('UNAUTHORIZED').toJSON() },
        { status: 401 },
      );
    }
    return Response.json(document());
  };
  return async (request) => {
    const { pathname } = new URL(request.url);
    if (request.method === 'GET' && pathname === '/health') {
      return Response.json({ ok: true });
    }
    if (request.method === 'GET' && pathname === '/openapi.json') {
      return forSignedIn(request, 'openapi', () => {
        openapi ??= openapiDocument();
        return openapi;
      });
    }
    if (request.method === 'GET' && pathname === '/catalog.json') {
      return forSignedIn(request, 'catalog', () => {
        catalog ??= catalogDocument();
        return catalog;
      });
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
    return new Response('Not Found', { status: 404 });
  };
}
