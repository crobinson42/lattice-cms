import { storeCases } from '@latticecms/core/store/conformance';
import { afterAll, afterEach, beforeEach, describe, it } from 'vitest';
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
