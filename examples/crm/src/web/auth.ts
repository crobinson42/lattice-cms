import { createClient } from '@ts-pf/client';
import { FetchLink } from '@ts-pf/client-http';
import type { InferContractOutputs } from '@ts-pf/contract';
// Types only: the contract's module imports server code, which never
// reaches the browser (bundle.test.ts checks).
import type { authContract } from '../servers/auth/contract.js';

type AuthOutputs = InferContractOutputs<typeof authContract>;

/** What login returns: the session's token and the user's id. */
export type Signed = AuthOutputs['login'];

/** An organization the user is a member of. */
export type Organization = AuthOutputs['organizations'][number];

/** The one client on the crm's `/auth` router, over `fetch`. */
export function authClient(fetch: typeof globalThis.fetch) {
  return createClient<typeof authContract>(
    new FetchLink({ url: '/auth', fetch }),
  );
}
