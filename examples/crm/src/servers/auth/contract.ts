import { latticeErrors } from '@latticecms/core';
import { procedure, router } from '@ts-pf/contract';
import { z } from 'zod';
import { loginInput } from '../../app/use-cases/auth/login.js';

/**
 * Sign-in, sign-out and the caller's organizations, served at `/auth`,
 * beside Lattice's `/rpc`. A separate router, so Lattice's procedures keep
 * a required actor. Every login refusal is one UNAUTHORIZED.
 */
export const authContract = router({
  login: procedure
    .input(loginInput)
    // The user's id too, so a client can find its own membership and tasks.
    .output(z.object({ token: z.string().min(1), userId: z.string().min(1) }))
    .errors({
      UNAUTHORIZED: { status: 401, message: 'The credentials are not valid' },
    }),
  logout: procedure.input(z.object({})).output(z.null()),
  /**
   * The organizations the signed-in user is a member of, by name, for an
   * organization switcher. It needs a session and no organization header:
   * the caller has not picked one yet. Support acts in none, so it gets none.
   */
  organizations: procedure
    .input(z.object({}))
    .output(z.array(z.object({ id: z.string(), name: z.string() })))
    .errors({ UNAUTHORIZED: latticeErrors.UNAUTHORIZED }),
});
