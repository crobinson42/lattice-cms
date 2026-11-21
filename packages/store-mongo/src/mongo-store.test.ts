import { storeCases } from '@latticecms/core/store/conformance';
import { MongoMemoryServer } from 'mongodb-memory-server';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from 'vitest';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

// Imported by package name, as any adapter imports the suite.
describe('MongoStore conformance', () => {
  const dbs = databases();
  let store: MongoStore;
  let database: string;

  beforeEach(async () => {
    database = dbs.fresh();
    store = new MongoStore({ url: dbs.url, database });
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
    await dbs.drop(database);
  });

  afterAll(() => dbs.close());

  it.each(storeCases)('$name', ({ run }) => run(store));
});

// A standalone server has no transactions: the cases that need them are
// filtered out, and the rest pass, so the tag is honest.
describe('MongoStore conformance on a standalone server', () => {
  let standalone: MongoMemoryServer;
  let store: MongoStore;

  beforeAll(async () => {
    standalone = await MongoMemoryServer.create();
  });

  afterAll(async () => {
    await standalone.stop();
  });

  beforeEach(async () => {
    store = new MongoStore({
      url: standalone.getUri(),
      database: `case_${crypto.randomUUID().replaceAll('-', '')}`,
    });
    await store.start();
  });

  afterEach(async () => {
    await store.stop();
  });

  it.each(storeCases.filter((c) => !c.needs?.includes('transactions')))(
    '$name',
    ({ run }) => run(store),
  );
});
