import type { Logger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
import { PFError } from '@ts-pf/protocol';
import { createImplementer } from '@ts-pf/server';
import type { Login } from '../../app/use-cases/auth/login.js';
import { LoginError } from '../../domain/errors/auth.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import type { CrmApp } from '../app.js';
import { authContract } from './contract.js';

/**
 * Each `/auth` request's facts. `token` is the bearer token, for logout.
 * `signedIn` is the edge's session check, as `/rpc` runs it: the user id,
 * or the edge's one UNAUTHORIZED. Only a procedure that needs a session
 * calls it, so a login logs no refusal.
 */
export type AuthRpcCtx = {
  readonly logger: Logger;
  readonly token: string | undefined;
  readonly signedIn: () => Promise<string>;
};

/**
 * The `/auth` router. Login checks the credentials with the use case, then
 * opens a session; the use case never sees a session or a token.
 * `organizations` reads memberships and organizations as trusted edge code,
 * as the edge's membership check does: no actor exists yet.
 */
export function createAuthRouter(deps: {
  readonly login: Login;
  readonly sessions: CrmSessions;
  readonly crm: Pick<CrmApp, 'repos'>;
  /** User ids that act as support, from `CRM_SUPPORT_USER_IDS`. */
  readonly support: ReadonlySet<string>;
}) {
  const { memberships, organizations } = deps.crm.repos;
  const impl = createImplementer(authContract).$context<AuthRpcCtx>();
  return impl.router({
    login: impl.login.handler(async ({ context, input }) => {
      try {
        const { userId } = await deps.login.execute(
          { logger: context.logger },
          input,
        );
        return { token: await deps.sessions.open({ userId }), userId };
      } catch (error) {
        if (!LoginError.is(error)) throw error;
        throw new PFError({
          code: 'UNAUTHORIZED',
          status: 401,
          message: error.message,
          cause: error,
        });
      }
    }),
    // A missing or bad token is already signed out.
    logout: impl.logout.handler(async ({ context }) => {
      await deps.sessions.close(context.token);
      return null;
    }),
    organizations: impl.organizations.handler(async ({ context }) => {
      const userId = await context.signedIn();
      // Support acts in no organization; it reads them all through /rpc.
      if (deps.support.has(userId)) return [];
      const ids: string[] = [];
      let after: string | undefined;
      do {
        const page = await memberships.find(
          {
            where: { userId: { eq: userId } },
            limit: 100,
            ...(after === undefined ? {} : { after }),
          },
          unscoped,
        );
        ids.push(...page.docs.map((member) => member.organizationId));
        after = page.next ?? undefined;
      } while (after !== undefined);
      const found = await organizations.getMany(ids, unscoped);
      return found
        .map(({ id, name }) => ({ id, name }))
        .sort(
          (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
        );
    }),
  });
}
