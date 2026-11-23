import { ConsoleLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { role } from '../../domain/collections/memberships.js';
import { provisionDevUser } from '../../infra/auth/dev-session.js';
import { redisSessions } from '../../infra/auth/sessions.js';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { createApp } from '../app.js';
import { storeLogin } from '../auth/login.js';

/**
 * Sets a user's email and password, adds a membership in the organization
 * with that name (creating it if needed), and prints a session token. Local
 * development only. The password needs 12 characters or more.
 *
 * npm run dev:user -w @latticecms/example-crm -- <userId> <email> <password> <organization> [member|manager]
 */
const [
  userId = '',
  email = '',
  password = '',
  organization = '',
  given = 'member',
] = process.argv.slice(2).map((arg) => arg.trim());
const parsed = role.safeParse(given);
if (
  userId === '' ||
  email === '' ||
  password === '' ||
  organization === '' ||
  !parsed.success
) {
  console.error(
    'usage: npm run dev:user -- <userId> <email> <password> <organization> [member|manager]',
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
      { userId, email, password, organization, role: parsed.data },
    ),
  );
} finally {
  await sessionStore.stop();
  await store.stop();
}
