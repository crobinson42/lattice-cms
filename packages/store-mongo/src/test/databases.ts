import { MongoClient } from 'mongodb';
import { inject } from 'vitest';

/**
 * A fresh database name per test on the run's replica set, and a client of
 * the test's own to drop it, so `MongoStore` needs no test-only surface.
 */
export function databases() {
  const url = inject('mongoUrl');
  const client = new MongoClient(url);
  return {
    url,
    fresh: () => `t_${crypto.randomUUID().replaceAll('-', '')}`,
    drop: (database: string) => client.db(database).dropDatabase(),
    close: () => client.close(),
  };
}
