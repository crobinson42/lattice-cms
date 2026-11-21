import { ConsoleLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { redisSessions } from '../../infra/auth/sessions.js';
import { supportUserIds } from '../../infra/auth/support.js';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { start } from './server.js';

const logger = new ConsoleLogger();
const url = process.env.MONGODB_URL;
if (url === undefined) throw new Error('Set MONGODB_URL');
const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'crm',
});
const redisUrl = process.env.REDIS_URL;
if (redisUrl === undefined) throw new Error('Set REDIS_URL');

// Sessions read their config now, so a missing secret fails at startup.
const { sessions, store: sessionStore } = redisSessions({
  env: process.env,
  redisUrl,
  logger,
});
await sessionStore.start();
const running = await start({
  store,
  // Events are logged, not queued, until the app has a queue.
  events: new LoggingDomainEventPublisher({ logger }),
  sessions,
  support: supportUserIds(process.env),
  logger,
  port: Number(process.env.PORT ?? 3000),
});

// Stop taking requests, let those in flight finish, then close the stores.
async function shutdown(signal: string): Promise<void> {
  logger.info('http stopping', { signal });
  await running.stop();
  await sessionStore.stop();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
