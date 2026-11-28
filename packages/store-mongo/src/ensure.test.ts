import { NoopLogger } from '@hexok/logger';
import { collection, family, framework, LatticeError } from '@latticecms/core';
import type { Index } from '@latticecms/core/store';
import { MongoClient } from 'mongodb';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

const AppUseCase = family({
  actor: z.object({ userId: z.string() }),
  actorId: (actor) => actor.userId,
});

const Accounts = collection('accounts', {
  schema: z.object({ email: z.string(), plan: z.string() }),
  indexes: [
    { fields: { email: 1 }, unique: true },
    { fields: { plan: 1, createdAt: -1 } },
  ],
});

describe('build().ensure() on MongoStore', () => {
  it('creates the declared indexes, idempotently, and a unique one gives CONFLICT', async () => {
    const database = dbs.fresh();
    const store = new MongoStore({ url: dbs.url, database });
    await store.start();
    const { ensure, useCases, context } = framework({ family: AppUseCase })
      .collection(Accounts, {
        access: { read: () => true, create: () => true },
      })
      .build({ store, events: { publish: async (_event: object) => {} } });

    await ensure();
    await ensure();

    const ctx = () =>
      context({ actor: { userId: 'u1' }, logger: new NoopLogger() });
    await useCases.accounts.create.execute(ctx(), {
      email: 'a@x',
      plan: 'free',
    });
    const error = await useCases.accounts.create
      .execute(ctx(), { email: 'a@x', plan: 'pro' })
      .catch((caught: unknown) => caught);
    expect(LatticeError.is(error) && error.code).toBe('CONFLICT');
    expect(await useCases.accounts.count.execute(ctx(), {})).toEqual({
      count: 1,
    });

    await store.stop();
    await dbs.drop(database);
  });

  it('names the existing index when one that differs holds the declared name', async () => {
    const database = dbs.fresh();
    const store = new MongoStore({ url: dbs.url, database });
    await store.start();
    await store.ensure('accounts', [{ fields: { email: 1 } }]);
    await store.ensure('accounts', [{ fields: { id: 1, plan: -1 } }]);
    const raw = new MongoClient(dbs.url);
    await raw
      .db(database)
      .collection('accounts')
      .createIndex({ plan: 1 }, { name: 'email_1_plan_1' });

    const declared: [Index, string][] = [
      [{ fields: { email: 1 }, unique: true }, 'email_1'],
      [{ fields: { email: 1 }, unique: true, present: ['email'] }, 'email_1'],
      [{ fields: { id: 1, plan: -1 }, unique: true }, '_id_1_plan_-1'],
      [{ fields: { email: 1, plan: 1 } }, 'email_1_plan_1'],
    ];
    for (const [index, name] of declared) {
      const error = await store
        .ensure('accounts', [index])
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({
        message: `MongoStore: "accounts" has an index "${name}" that differs from the declared one on ${Object.keys(index.fields).join(', ')}. Changing an index is a migration: drop it in one, since migrations run before ensure().`,
        cause: { code: 86 },
      });
    }

    await raw.close();
    await store.stop();
    await dbs.drop(database);
  });

  it('takes the declared index under another name as ensured', async () => {
    const database = dbs.fresh();
    const store = new MongoStore({ url: dbs.url, database });
    await store.start();
    const raw = new MongoClient(dbs.url);
    const accounts = raw.db(database).collection('accounts');
    await accounts.createIndex(
      { email: 1 },
      { name: 'by_email', unique: true },
    );

    await store.ensure('accounts', [{ fields: { email: 1 }, unique: true }]);
    expect((await accounts.indexes()).map((index) => index.name)).toEqual([
      '_id_',
      'by_email',
    ]);

    await raw.close();

    await store.stop();
    await dbs.drop(database);
  });
});
