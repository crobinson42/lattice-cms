import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { loginInput } from '../../app/use-cases/auth/login.js';

/**
 * Sign-in and sign-out, served at `/auth`, beside Lattice's `/rpc`. A
 * separate router, so Lattice's procedures keep a required actor. Every
 * login refusal is one UNAUTHORIZED.
 */
export const authContract = router({
  login: procedure
    .input(loginInput)
    .output(z.object({ token: z.string().min(1) }))
    .errors({
      UNAUTHORIZED: { status: 401, message: 'The credentials are not valid' },
    }),
  logout: procedure.input(z.object({})).output(z.null()),
});
