import type { Logger } from '@hexok/logger';
import { type MongoStore, migrate } from '@latticecms/store-mongo';
import { serve } from 'srvx';
import type { DomainEventPublisher } from '../../app/ports/events/domain-event-publisher.js';
import type { CrmSessions } from '../../infra/auth/sessions.js';
import { migrations } from '../../infra/migrations/index.js';
import { createApp } from '../app.js';
import { storeLogin } from '../auth/login.js';
import { createHttpHandler } from './handler.js';

/** A running server, and how to stop it. */
export type Running = {
  readonly url: URL;
  /** Stops taking requests, lets those in flight finish, then closes the store. */
  stop(): Promise<void>;
};

/**
 * Starts the store, migrates, creates indexes, then serves. Migrations run
 * before indexes, so one can fix data an index depends on. The caller owns
 * the session store's lifecycle.
 */
export async function start(deps: {
  readonly store: MongoStore;
  readonly events: DomainEventPublisher;
  readonly sessions: CrmSessions;
  readonly support: ReadonlySet<string>;
  readonly logger: Logger;
  readonly port: number;
  readonly hostname?: string;
}): Promise<Running> {
  const { store, logger } = deps;
  const crm = createApp({ store, events: deps.events });
  await store.start();
  await migrate(store, migrations, { logger });
  await crm.ensure();
  const { credentials, login } = storeLogin(store);
  await credentials.ensure();

  const server = serve({
    port: deps.port,
    ...(deps.hostname === undefined ? {} : { hostname: deps.hostname }),
    fetch: createHttpHandler({
      crm,
      login,
      sessions: deps.sessions,
      support: deps.support,
      logger,
    }),
    silent: true,
  });
  await server.ready();
  const url = new URL(server.url ?? `http://localhost:${deps.port}/`);
  logger.info('http listening', { url: url.href });
  return {
    url,
    async stop() {
      await server.close();
      await store.stop();
    },
  };
}
