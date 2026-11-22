import { ConsoleLogger } from '@hexok/logger';
import { RedisQueue } from '@hexok/queue-redis';
import { MongoStore } from '@latticecms/store-mongo';
import {
  ConfigWebhookEndpoints,
  configuredEndpoints,
} from '../../infra/webhooks/config-endpoints.js';
import { startWorker } from './worker.js';

const logger = new ConsoleLogger();
const url = process.env.MONGODB_URL;
if (url === undefined) throw new Error('Set MONGODB_URL');
const redis = process.env.REDIS_URL;
if (redis === undefined) throw new Error('Set REDIS_URL');

const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'crm',
});
// The queue the HTTP process publishes domain events to.
const domainQueue = new RedisQueue({
  redis,
  keyPrefix: 'crm:domain:',
  logger: logger.child({ component: 'domain-queue' }),
});
// The webhook sender's own queue, as app-template keeps it.
const webhooksQueue = new RedisQueue({
  redis,
  keyPrefix: 'crm:webhooks:',
  delayedPrefix: 'crm:webhooks-delayed:',
  // Acknowledged entries count against maxLen until the age trim.
  retentionMs: 3_600_000,
  maxLen: 100_000,
  // The 15 s send deadline plus two 10 s hooks.
  stopTimeoutMs: 35_000,
  logger: logger.child({ component: 'webhooks-queue' }),
});
// Plain http and private addresses only for a receiver on this machine.
const allowPrivate = process.env.WEBHOOKS_ALLOW_PRIVATE === '1';

await store.start();
await domainQueue.start();
await webhooksQueue.start();
const worker = await startWorker({
  store,
  domainQueue,
  webhooksQueue,
  endpoints: new ConfigWebhookEndpoints(
    configuredEndpoints(process.env.CRM_WEBHOOK_ENDPOINTS),
  ),
  logger,
  webhooks: { httpsOnly: !allowPrivate, allowPrivate },
});

// Stop taking events, let those in flight finish, then close the queues
// and the store.
async function shutdown(signal: string): Promise<void> {
  logger.info('worker stopping', { signal });
  await worker.stop();
  await domainQueue.stop();
  await webhooksQueue.stop();
  await store.stop();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
