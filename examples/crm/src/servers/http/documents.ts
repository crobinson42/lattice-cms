import { LatticeError } from '@latticecms/core';
import { catalogDocument } from '../rpc/catalog.js';
import { openapiDocument } from '../rpc/openapi.js';
import { requestIdOf, signedIn } from './caller.js';
import type { HttpDeps } from './handler.js';

/**
 * The API's documents, `/openapi.json` and `/catalog.json`, for signed-in
 * users only: their schemas say which fields are masked. Any signed-in
 * user, so no organization is needed. Each is built on its first request
 * and kept: the contract does not change while serving.
 */
export function signedInDocuments(deps: HttpDeps) {
  let openapi: ReturnType<typeof openapiDocument> | undefined;
  let catalog: ReturnType<typeof catalogDocument> | undefined;
  const serve = async (
    request: Request,
    edge: 'openapi' | 'catalog',
    document: () => unknown,
  ): Promise<Response> => {
    const logger = deps.logger.child({ requestId: requestIdOf(request) });
    if ((await signedIn(deps, request, logger, edge)) === undefined) {
      // The body /rpc sends for the same refusal.
      return Response.json(
        {
          ok: false,
          error: deps.crm.clientError(LatticeError.UNAUTHORIZED()).toJSON(),
        },
        { status: 401 },
      );
    }
    return Response.json(document());
  };
  return {
    openapi: (request: Request) =>
      serve(request, 'openapi', () => {
        openapi ??= openapiDocument();
        return openapi;
      }),
    catalog: (request: Request) =>
      serve(request, 'catalog', () => {
        catalog ??= catalogDocument();
        return catalog;
      }),
  };
}
