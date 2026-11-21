import type { Logger } from '@hexok/logger';
import { PFError } from '@ts-pf/protocol';
import { createImplementer } from '@ts-pf/server';
import type { Login } from '../../app/use-cases/auth/login.js';
import { LoginError } from '../../domain/errors/auth.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import { authContract } from './contract.js';

/** Each `/auth` request's facts. `token` is the bearer token, for logout. */
export type AuthRpcCtx = {
  readonly logger: Logger;
  readonly token: string | undefined;
};

/**
 * The `/auth` router. Login checks the credentials with the use case, then
 * opens a session; the use case never sees a session or a token.
 */
export function createAuthRouter(deps: {
  readonly login: Login;
  readonly sessions: CrmSessions;
}) {
  const impl = createImplementer(authContract).$context<AuthRpcCtx>();
  return impl.router({
    login: impl.login.handler(async ({ context, input }) => {
      try {
        const { userId } = await deps.login.execute(
          { logger: context.logger },
          input,
        );
        return { token: await deps.sessions.open({ userId }) };
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
  });
}
