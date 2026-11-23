import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import type { authContract } from '../servers/auth/contract.js';

/** A client on the crm's `/auth` router. Its types only: no server code. */
export function authClient(fetch: typeof globalThis.fetch) {
  return createClient<typeof authContract>(
    new FetchLink({ url: '/auth', fetch }),
  );
}
