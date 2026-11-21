import type { UseCase } from 'hexok';
import { z } from 'zod';
import { LoginError } from '../../../domain/errors/auth.js';
import type { Credentials } from '../../ports/auth/credentials.js';
import {
  attemptKey,
  type LoginAttempts,
} from '../../ports/auth/login-attempts.js';
import { AuthUseCase } from './context.js';

/**
 * Normalized before it is validated, so " Ann@X.com " signs in. The
 * password keeps min(1): an old short one still reaches the check and the
 * limit, and is refused like any other. max bounds scrypt's input.
 */
export const loginInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
  password: z.string().min(1).max(1024),
});

export type LoginInput = z.output<typeof loginInput>;

/**
 * Checks an email and password. A wrong password, an unknown email and a
 * locked email are the same `LoginError.Refused`; the log line says which,
 * by the attempt key, never the email. The edge opens the session.
 */
export class Login extends AuthUseCase('auth.login', { input: loginInput }) {
  constructor(
    private readonly deps: {
      readonly credentials: Credentials;
      readonly attempts: LoginAttempts;
    },
  ) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof AuthUseCase>,
    input: LoginInput,
  ): Promise<{ readonly userId: string }> {
    const key = attemptKey(input.email);
    const refused = (reason: string) => {
      ctx.logger.info('auth.login', {
        outcome: 'refused',
        reason,
        attemptKey: key,
      });
      return LoginError.Refused();
    };
    if (await this.deps.attempts.isLocked(key)) throw refused('locked');
    const found = await this.deps.credentials.verify(
      input.email,
      input.password,
    );
    if (!found.ok) {
      // Known or not, the email's failures count, so the limit does not
      // tell which emails have accounts.
      await this.deps.attempts.fail(key);
      throw refused(found.code);
    }
    await this.deps.attempts.reset(key);
    ctx.logger.info('auth.login', {
      outcome: 'ok',
      userId: found.value.userId,
    });
    return found.value;
  }
}
