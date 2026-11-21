import { NoopLogger } from '@hexok/logger';
import { collection, family, framework, LatticeError } from '@latticecms/core';
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
});
