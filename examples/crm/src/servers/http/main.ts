import { ConsoleLogger } from '@hexok/logger';
import { MongoStore, migrate } from '@latticecms/store-mongo';
import { serve } from 'srvx';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { migrations } from '../../infra/migrations/index.js';
import { createApp } from '../app.js';
import { createHttpHandler } from './handler.js';

const logger = new ConsoleLogger();
const url = process.env.MONGODB_URL;
if (url === undefined) throw new Error('Set MONGODB_URL');
const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'crm',
});
// Events are logged, not queued, until the app has a queue.
const crm = createApp({
  store,
  events: new LoggingDomainEventPublisher({ logger }),
});

// Start the store, migrate, then create indexes, so a migration can fix
// data before an index that depends on it is built.
await store.start();
await migrate(store, migrations, { logger });
await crm.ensure();

const server = serve({
  port: Number(process.env.PORT ?? 3000),
  fetch: createHttpHandler(crm, { logger }),
  silent: true,
});
await server.ready();
logger.info('http listening', { url: server.url });

// Stop taking requests, let those in flight finish, then close the store.
async function shutdown(signal: string): Promise<void> {
  logger.info('http stopping', { signal });
  await server.close();
  await store.stop();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
