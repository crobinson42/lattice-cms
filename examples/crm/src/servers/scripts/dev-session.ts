import { ConsoleLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { openDevSession } from '../../infra/auth/dev-session.js';
import { redisSessions } from '../../infra/auth/sessions.js';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { createApp } from '../app.js';

/**
 * Prints a session token for a user in an organization, adding the
 * membership if needed. Local development only: it checks no password.
 *
 * npm run dev:session -w @latticecms/example-crm -- <userId> <organizationId>
 */
const [userId = '', organizationId = ''] = process.argv
  .slice(2)
  .map((arg) => arg.trim());
if (userId === '' || organizationId === '') {
  console.error('usage: npm run dev:session -- <userId> <organizationId>');
  process.exit(1);
}
const url = process.env.MONGODB_URL;
const redisUrl = process.env.REDIS_URL;
if (url === undefined || redisUrl === undefined) {
  console.error('Set MONGODB_URL and REDIS_URL');
  process.exit(1);
}

const logger = new ConsoleLogger();
const store = new MongoStore({
  url,
  database: process.env.MONGODB_DATABASE ?? 'crm',
});
const { sessions, store: sessionStore } = redisSessions({
  env: process.env,
  redisUrl,
  logger,
});
const crm = createApp({
  store,
  events: new LoggingDomainEventPublisher({ logger }),
});
await store.start();
await sessionStore.start();
try {
  await crm.ensure();
  console.log(
    await openDevSession({ crm, sessions }, { userId, organizationId }),
  );
} finally {
  await sessionStore.stop();
  await store.stop();
}
