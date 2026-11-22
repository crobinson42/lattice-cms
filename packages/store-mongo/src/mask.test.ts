import { NoopLogger } from '@hexok/logger';
import {
  collection,
  family,
  framework,
  LatticeError,
  unscoped,
} from '@latticecms/core';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

const AppUseCase = family({
  actor: z.object({
    userId: z.string(),
    role: z.enum(['member', 'manager']),
  }),
  actorId: (actor) => actor.userId,
});

const Deals = collection('deals', {
  schema: z.object({ title: z.string(), amount: z.number() }),
  maskable: ['amount'],
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

describe('a masked field on MongoStore', () => {
  async function setup() {
    const built = framework({ family: AppUseCase })
      .collection(Deals, {
        access: {
          read: () => true,
          create: () => true,
          update: () => true,
          delete: () => true,
        },
        fields: { amount: { read: ({ actor }) => actor.role === 'manager' } },
      })
      .build({ store, events: { async publish(_event: object) {} } });
    await built.repos.deals.insert({ title: 'big', amount: 4242 }, unscoped);
    const as = (role: 'member' | 'manager') =>
      built.context({
        actor: { userId: role, role },
        logger: new NoopLogger(),
      });
    return { ...built, as };
  }

  /** The error code of a call, or its result. */
  function settle(call: Promise<unknown>): Promise<unknown> {
    return call.then(
      (value) => value,
      (error: unknown) => (LatticeError.is(error) ? error.code : error),
    );
  }

  it('refuses a member’s filter or sort on it, whatever value is tried', async () => {
    const { useCases, as } = await setup();

    const answers = new Set<unknown>();
    for (const value of [0, 4241, 4242, 4243, 10_000]) {
      for (const op of ['gt', 'gte', 'lt', 'lte', 'eq', 'ne']) {
        answers.add(
          await settle(
            useCases.deals.count.execute(as('member'), {
              where: { amount: { [op]: value } },
            }),
          ),
        );
      }
    }
    answers.add(
      await settle(
        useCases.deals.find.execute(as('member'), { sort: ['-amount'] }),
      ),
    );

    expect(answers).toEqual(new Set(['VALIDATION']));
  });

  it('lets a manager filter and sort by it in the Mongo query', async () => {
    const { useCases, repos, as } = await setup();
    await repos.deals.insert({ title: 'small', amount: 1 }, unscoped);

    const counted = await useCases.deals.count.execute(as('manager'), {
      where: { amount: { gt: 4000 } },
    });
    const page = await useCases.deals.find.execute(as('manager'), {
      sort: ['-amount'],
    });

    expect(counted).toEqual({ count: 1 });
    expect(page.docs.map((doc) => doc.title)).toEqual(['big', 'small']);
  });
});
