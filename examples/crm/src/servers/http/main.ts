import { ConsoleLogger } from '@hexok/logger';
import { RedisQueue } from '@hexok/queue-redis';
import { redisSessions } from '../../infra/auth/sessions.js';
import { supportUserIds } from '../../infra/auth/support.js';
import { QueueDomainEventPublisher } from '../../infra/events/queue-domain-events.js';
import { mongoStore } from '../../infra/store.js';
import { start } from './server.js';

const logger = new ConsoleLogger();
const store = mongoStore(process.env);
const redisUrl = process.env.REDIS_URL;
if (redisUrl === undefined) throw new Error('Set REDIS_URL');

// Sessions read their config now, so a missing secret fails at startup.
const { sessions, store: sessionStore } = redisSessions({
  env: process.env,
  redisUrl,
  logger,
});
// The queue the worker consumes domain events from. This process only
// publishes to it.
const domainQueue = new RedisQueue({
  redis: redisUrl,
  keyPrefix: 'crm:domain:',
  logger: logger.child({ component: 'domain-queue' }),
});
await sessionStore.start();
await domainQueue.start();
const running = await start({
  store,
  events: new QueueDomainEventPublisher({ queue: domainQueue }),
  sessions,
  support: supportUserIds(process.env),
  logger,
  port: Number(process.env.PORT ?? 3000),
  // dist/servers/http/main.js serves dist/web, which `npm run build` makes.
  web: new URL('../../web/', import.meta.url),
});

// Stop taking requests, let those in flight finish, then close the stores.
async function shutdown(signal: string): Promise<void> {
  logger.info('http stopping', { signal });
  await running.stop();
  await domainQueue.stop();
  await sessionStore.stop();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
