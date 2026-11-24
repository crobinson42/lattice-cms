import { NoopLogger } from '@hexok/logger';
import { collection, family, framework } from '@latticecms/core';
import { MongoClient } from 'mongodb';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
const raw = new MongoClient(dbs.url);
afterAll(async () => {
  await raw.close();
  await dbs.close();
});

const AppUseCase = family({
  actor: z.object({ userId: z.string() }),
  actorId: (actor) => actor.userId,
});

const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().nullable().optional(),
  }),
});

let database: string;
let store: MongoStore;

beforeEach(async () => {
  database = dbs.fresh();
  store = new MongoStore({ url: dbs.url, database });
  await store.start();
});

afterEach(async () => {
  await store.stop();
  await dbs.drop(database);
});

describe('update on MongoStore', () => {
  it('unsets a field a patch clears with null, and stores null in a nullable one', async () => {
    const { useCases, context } = framework({ family: AppUseCase })
      .collection(Contacts, {
        access: {
          read: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
      })
      .build({ store, events: { async publish(_event: object) {} } });
    const ctx = context({
      actor: { userId: 'u' },
      logger: new NoopLogger(),
    });
    const ada = await useCases.contacts.create.execute(ctx, {
      name: 'Ada',
      email: 'ada@x.test',
      phone: '1',
    });

    await useCases.contacts.update.execute(ctx, {
      id: ada.id,
      email: null,
      phone: null,
    });

    const stored = await raw
      .db(database)
      .collection<{ _id: string }>('contacts')
      .findOne({ _id: ada.id });
    expect(stored).not.toHaveProperty('email');
    expect(stored).toMatchObject({ name: 'Ada', phone: null });
  });
});
