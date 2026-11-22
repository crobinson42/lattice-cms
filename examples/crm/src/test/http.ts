import { MemoryLogger } from '@hexok/logger';
import { type CollectionStore, unscoped } from '@latticecms/core';
import type { CrmSessions } from '../infra/auth/sessions.js';
import type { Hasher } from '../infra/auth/store-credentials.js';
import { MemoryDomainEventPublisher } from '../infra/events/memory-domain-events.js';
import { createApp } from '../servers/app.js';
import { storeLogin } from '../servers/auth/login.js';
import {
  createHttpHandler,
  organizationHeader,
} from '../servers/http/handler.js';
import { testSessions } from './sessions.js';

/** How a test request authenticates: a token, an organization, or neither. */
export type As = {
  readonly token?: string;
  readonly org?: string;
  readonly headers?: Readonly<Record<string, string>>;
};

/** A POST to `/rpc/<path>` with `input`, sent `as` someone. */
export function rpcRequest(path: string, input: unknown, as: As): Request {
  return new Request(`http://localhost/rpc/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(as.token === undefined
        ? {}
        : { authorization: `Bearer ${as.token}` }),
      ...(as.org === undefined ? {} : { [organizationHeader]: as.org }),
      ...as.headers,
    },
    body: JSON.stringify({ input }),
  });
}

/**
 * The crm's HTTP edge over `store`, with real signed sessions in memory.
 * `member` adds a membership as trusted code does; `signIn` opens a session.
 */
export function httpSetup(
  store: CollectionStore,
  options: {
    readonly sessions?: CrmSessions;
    readonly support?: readonly string[];
    readonly now?: () => number;
    readonly hasher?: Hasher;
  } = {},
) {
  const logger = new MemoryLogger();
  const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
  const sessions = options.sessions ?? testSessions();
  const auth = storeLogin(store, {
    ...(options.now === undefined ? {} : { now: options.now }),
    ...(options.hasher === undefined ? {} : { hasher: options.hasher }),
  });
  const fetch = createHttpHandler({
    crm,
    login: auth.login,
    sessions,
    support: new Set(options.support ?? []),
    logger,
  });
  return {
    ...crm,
    logger,
    sessions,
    credentials: auth.credentials,
    fetch,
    async member(
      userId: string,
      organizationId: string,
      role: 'member' | 'manager' = 'member',
    ) {
      await crm.repos.memberships.insert(
        { userId, organizationId, role },
        unscoped,
      );
    },
    signIn(userId: string): Promise<string> {
      return sessions.open({ userId });
    },
  };
}

/** The refusal lines the edge logged, as `[code, reason]`. */
export function refusals(logger: MemoryLogger): unknown[][] {
  return logger.records
    .filter((record) => record.fields.outcome === 'refused')
    .map((record) => [record.fields.code, record.fields.reason]);
}
