import { NoopLogger } from '@hexok/logger';
import { migrate } from '@latticecms/store-mongo';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { migrations } from '../../infra/migrations/index.js';
import { demoPassword, seedDemo } from '../../infra/seed/demo.js';
import { mongoStore } from '../../infra/store.js';
import { createApp } from '../app.js';
import { storeLogin } from '../auth/login.js';

/**
 * Fills an empty database with the demo organizations, users and pipeline,
 * then prints how to sign in. Local development only. It needs MongoDB
 * alone: its events stay in memory and go nowhere, so Redis need not run.
 *
 * npm run seed -w @latticecms/example-crm
 */
const store = mongoStore(process.env);
const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
const { credentials } = storeLogin(store);
await store.start();
try {
  await migrate(store, migrations, { logger: new NoopLogger() });
  await crm.ensure();
  await credentials.ensure();
  const users = await seedDemo({ crm, credentials, now: new Date() });
  const rows = [
    ['Name', 'Email', 'Password', 'Role'],
    ...users.map(({ name, email, role }) => [name, email, demoPassword, role]),
  ];
  const widths = rows[0]?.map((_, column) =>
    Math.max(...rows.map((row) => row[column]?.length ?? 0)),
  );
  console.log('Seeded the demo data. Sign in with:\n');
  for (const row of rows) {
    console.log(
      row.map((cell, column) => cell.padEnd(widths?.[column] ?? 0)).join('  '),
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await store.stop();
}
