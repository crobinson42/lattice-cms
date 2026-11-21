import { ConsoleLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { provisionDevUser } from '../../infra/auth/dev-session.js';
import { redisSessions } from '../../infra/auth/sessions.js';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { createApp } from '../app.js';
import { storeLogin } from '../auth/login.js';

/**
 * Sets a user's email and password, adds a membership, and prints a session
 * token. Local development only. The password needs 12 characters or more.
 *
 * npm run dev:user -w @latticecms/example-crm -- <userId> <email> <password> <organizationId>
 */
const [userId = '', email = '', password = '', organizationId = ''] =
  process.argv.slice(2).map((arg) => arg.trim());
if (userId === '' || email === '' || password === '' || organizationId === '') {
  console.error(
    'usage: npm run dev:user -- <userId> <email> <password> <organizationId>',
  );
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
const { credentials } = storeLogin(store);
await store.start();
await sessionStore.start();
try {
  await crm.ensure();
  await credentials.ensure();
  console.log(
    await provisionDevUser(
      { crm, sessions, credentials },
      { userId, email, password, organizationId },
    ),
  );
} finally {
  await sessionStore.stop();
  await store.stop();
}
