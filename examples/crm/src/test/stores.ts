import { type CollectionStore, MemoryStore } from '@latticecms/core';
import { MongoStore } from '@latticecms/store-mongo';
import { MongoClient } from 'mongodb';
import { afterEach, beforeEach, inject } from 'vitest';

/** A store opened for one test, and how to close it. */
type Opened = { readonly store: CollectionStore; close(): Promise<void> };

/** A store the app's tests run on. */
export type Backend = { readonly name: string; open(): Promise<Opened> };

const memory: Backend = {
  name: 'MemoryStore',
  async open() {
    const store = new MemoryStore();
    await store.start();
    return { store, close: () => store.stop() };
  },
};

// A database per test on the run's replica set, dropped after it.
const mongo: Backend = {
  name: 'MongoStore',
  async open() {
    const url = inject('mongoUrl');
    const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
    const store = new MongoStore({ url, database });
    await store.start();
    return {
      store,
      async close() {
        await store.stop();
        const client = new MongoClient(url);
        await client.db(database).dropDatabase();
        await client.close();
      },
    };
  },
};

/** Both stores: the app's tests run on each. */
export const backends: readonly Backend[] = [memory, mongo];

/**
 * The store of the running test: `backend` opens a fresh one before each
 * test and closes it after. Call it inside a describe.
 */
export function storeOf(backend: Backend): () => CollectionStore {
  let opened: Opened | undefined;
  beforeEach(async () => {
    opened = await backend.open();
  });
  afterEach(async () => {
    await opened?.close();
    opened = undefined;
  });
  return () => {
    if (opened === undefined) throw new Error('no store outside a test');
    return opened.store;
  };
}
