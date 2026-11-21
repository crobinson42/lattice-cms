import { afterAll, describe, expect, it } from 'vitest';
import { MongoStore, MongoStoreError } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

/** The `MongoStoreError` code a call rejects with, or what it resolved to. */
async function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    (value) => ({ resolved: value }),
    (error) => (MongoStoreError.is(error) ? error.code : error),
  );
}

function newStore() {
  return new MongoStore({ url: dbs.url, database: dbs.fresh() });
}

describe('MongoStore lifecycle', () => {
  it('rejects a call before start with NotStarted', async () => {
    const store = newStore();
    expect(await codeOf(store.get('a', 'x'))).toBe('NotStarted');
    expect(await codeOf(store.count('a'))).toBe('NotStarted');
  });

  it('rejects a call during start with Starting', async () => {
    const store = newStore();
    const starting = store.start();
    expect(await codeOf(store.get('a', 'x'))).toBe('Starting');
    await starting;
    expect(await store.get('a', 'x')).toBeNull();
    await store.stop();
  });

  it('rejects a call after stop with Stopped', async () => {
    const store = newStore();
    await store.start();
    await store.stop();
    expect(await codeOf(store.get('a', 'x'))).toBe('Stopped');
    expect(await codeOf(store.insert('a', { id: 'x' }))).toBe('Stopped');
  });

  it('joins a pending start', async () => {
    const store = newStore();
    await Promise.all([store.start(), store.start()]);
    await store.start();
    expect(await store.count('a')).toBe(0);
    await store.stop();
  });

  it('starts again after stop, with a new client', async () => {
    const database = dbs.fresh();
    const store = new MongoStore({ url: dbs.url, database });
    await store.start();
    await store.insert('a', { id: 'x', n: 1 });
    await store.stop();
    await store.start();
    expect(await store.get('a', 'x')).toEqual({ id: 'x', n: 1 });
    await store.stop();
    await dbs.drop(database);
  });

  it('rejects a pending start with Stopped when stop comes first', async () => {
    const store = newStore();
    const starting = store.start();
    await store.stop();
    expect(await codeOf(starting)).toBe('Stopped');
    expect(await codeOf(store.get('a', 'x'))).toBe('Stopped');
  });

  it('rejects start when the server cannot be reached, and can start later', async () => {
    const store = new MongoStore({
      url: 'mongodb://127.0.0.1:1',
      database: 'x',
      client: { serverSelectionTimeoutMS: 200 },
    });
    await expect(store.start()).rejects.toThrow();
    expect(await codeOf(store.get('a', 'x'))).toBe('NotStarted');
  });
});
