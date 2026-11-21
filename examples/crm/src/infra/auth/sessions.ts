import { type Env, Sessions, sessionConfig } from '@hexok/auth';
import { JoseSessionToken, joseConfig } from '@hexok/auth-jose';
import { RedisSessionStore } from '@hexok/auth-redis';
import type { Logger } from '@hexok/logger';
import { z } from 'zod';

/**
 * What a session proves: the user, and nothing about an organization. The
 * edge picks the organization per request, so switching needs no new
 * session and a revoked membership stops the next request.
 */
export const identitySchema = z.object({ userId: z.string().min(1) });

export type Identity = z.output<typeof identitySchema>;

/** Login, logout and authentication of the crm's sessions. */
export type CrmSessions = Sessions<Identity>;

/**
 * Sessions in Redis, named by a signed JWT. Start `store` before the first
 * call and stop it on shutdown.
 *
 * `AUTH_TOKEN_SECRETS`, `AUTH_TOKEN_ISSUER` and `AUTH_TOKEN_AUDIENCE` are
 * required. `AUTH_SESSION_IDLE_SECONDS` and `AUTH_SESSION_ABSOLUTE_SECONDS`
 * default to 30 minutes and 8 hours. A bad value throws, naming each one.
 */
export function redisSessions(options: {
  readonly env: Env;
  readonly redisUrl: string;
  readonly logger: Logger;
}): {
  sessions: CrmSessions;
  store: RedisSessionStore<typeof identitySchema>;
} {
  const store = new RedisSessionStore({
    redis: options.redisUrl,
    identity: identitySchema,
    keyPrefix: 'crm:session:',
    logger: options.logger,
    ...sessionConfig(options.env),
  });
  const token = new JoseSessionToken(joseConfig(options.env));
  return { sessions: new Sessions({ store, token }), store };
}
