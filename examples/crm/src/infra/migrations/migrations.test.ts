import { MemoryLogger, NoopLogger } from '@hexok/logger';
import { MongoStore, migrate } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import { createApp } from '../../servers/app.js';
import { MemoryDomainEventPublisher } from '../events/memory-domain-events.js';
import { migrations } from './index.js';

describe('the migrations', () => {
  const url = inject('mongoUrl');
  const client = new MongoClient(url);
  let database: string;
  let store: MongoStore;

  beforeEach(async () => {
    database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
    store = new MongoStore({ url, database });
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
    await client.db(database).dropDatabase();
  });

  afterAll(() => client.close());

  it('backfill archived on old deals, so reads see them, and a second run changes nothing', async () => {
    // A deal written before `archived` existed.
    // Mongo's own document type: the stored shape, `_id` a string.
    type Stored = { _id: string } & Record<string, unknown>;
    await client.db(database).collection<Stored>('deals').insertOne({
      _id: 'old',
      title: 'Old',
      companyId: 'c1',
      amount: 1,
      stage: 'lead',
      organizationId: 'o1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const ctx = () =>
      crm.context({
        actor: { userId: 'u1', organizationId: 'o1' },
        logger: new NoopLogger(),
      });
    expect((await crm.useCases.deals.find.execute(ctx(), {})).docs).toEqual([]);

    const logger = new MemoryLogger();
    const first = await migrate(store, migrations, { logger });
    // The record is what keeps it from running twice; `up` is safe anyway.
    const migration = migrations[0];
    await migration?.up({
      db: client.db(database),
      signal: new AbortController().signal,
      logger,
    });

    expect(first.ran.map(({ name }) => name)).toEqual([
      'backfill-deal-archived',
    ]);
    expect(
      logger.records
        .filter((record) => record.message === 'deals backfilled')
        .map((record) => record.fields.modifiedCount),
    ).toEqual([1, 0]);
    expect((await migrate(store, migrations, { logger })).ran).toEqual([]);
    const { docs } = await crm.useCases.deals.find.execute(ctx(), {});
    expect(docs).toMatchObject([{ id: 'old', archived: false }]);
  });
});
