import { ConsoleLogger } from '@hexok/logger';
import { role } from '../../domain/collections/memberships.js';
import { openDevSession } from '../../infra/auth/dev-session.js';
import { redisSessions } from '../../infra/auth/sessions.js';
import { LoggingDomainEventPublisher } from '../../infra/events/logging-domain-events.js';
import { mongoStore } from '../../infra/store.js';
import { createApp } from '../app.js';

/**
 * Prints a session token for a user in an organization, by its name,
 * creating the organization and adding the membership if needed. Local
 * development only: it checks no password.
 *
 * npm run dev:session -w @latticecms/example-crm -- <userId> <name> <organization> [member|manager]
 */
const [userId = '', name = '', organization = '', given = 'member'] =
  process.argv.slice(2).map((arg) => arg.trim());
const parsed = role.safeParse(given);
if (userId === '' || name === '' || organization === '' || !parsed.success) {
  console.error(
    'usage: npm run dev:session -- <userId> <name> <organization> [member|manager]',
  );
  process.exit(1);
}
const redisUrl = process.env.REDIS_URL;
if (process.env.MONGODB_URL === undefined || redisUrl === undefined) {
  console.error('Set MONGODB_URL and REDIS_URL');
  process.exit(1);
}

const logger = new ConsoleLogger();
const store = mongoStore(process.env);
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
    await openDevSession(
      { crm, sessions },
      { userId, name, organization, role: parsed.data },
    ),
  );
} finally {
  await sessionStore.stop();
  await store.stop();
}
