import { LatticeError } from '@latticecms/core';
import {
  bearerAuthChallengeResponse,
  createMcpHandler,
  OAuthError,
  OAuthErrorCode,
} from '@modelcontextprotocol/server';
import { bindTools } from '@ts-pf/mcp';
import { createMcpFactory } from '@ts-pf/mcp/sdk';
import { crmTools } from '../mcp/toolset.js';
import { actorContext, requestIdOf, signedIn } from './caller.js';
import type { HttpDeps } from './handler.js';

/**
 * MCP at `/mcp`: every procedure is a tool, run in process with the same
 * guards, masking and spans as `/rpc`. The edge checks the session before
 * the MCP SDK sees the request, so a missing or dead token is a `401`
 * challenge, not a tool error. The user and request id ride to `context`
 * in `authInfo`, the one channel the SDK passes through; the organization
 * header is read there, per call, as on `/rpc`.
 */
export function mcpEdge(deps: HttpDeps, onError: (error: unknown) => void) {
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
        throw deps.crm.clientError(LatticeError.UNAUTHORIZED());
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
