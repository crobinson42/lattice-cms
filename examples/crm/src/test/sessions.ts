import { MemorySessionStore, Sessions } from '@hexok/auth';
import { JoseSessionToken } from '@hexok/auth-jose';
import type { CrmSessions, Identity } from '../infra/auth/sessions.js';

/** 32 bytes, base64url: the tests' signing secret. Never used outside tests. */
export const testSecret = 'dGVzdC1zZWNyZXQtZm9yLWNybS10ZXN0cy1vbmx5LTMyYg';

/** The tests' token settings. */
export const testToken: { readonly issuer: string; readonly audience: string } =
  { issuer: 'crm-test', audience: 'crm-test' };

/**
 * Real sessions, as production makes them, over a memory store: the token
 * is signed and verified, and the store decides. `now` moves its clock.
 */
export function testSessions(
  options: { readonly now?: () => number; readonly secret?: string } = {},
): CrmSessions {
  const store = new MemorySessionStore<Identity>({
    idleSeconds: 60,
    absoluteSeconds: 120,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const token = new JoseSessionToken({
    secrets: [options.secret ?? testSecret],
    ...testToken,
  });
  return new Sessions({ store, token });
}
