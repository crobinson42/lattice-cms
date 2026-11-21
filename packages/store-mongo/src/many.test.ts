import { NoopLogger } from '@hexok/logger';
import {
  collection,
  family,
  framework,
  LatticeError,
  many,
  unscoped,
} from '@latticecms/core';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
afterAll(() => dbs.close());

const AppUseCase = family({
  actor: z.object({ userId: z.string(), organizationId: z.string() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});

const tenant = 'organizationId';
const Categories = collection('categories', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Posts = collection('posts', {
  schema: z.object({ title: z.string() }),
  tenant,
  relations: {
    categories: many('categories', {
      through: 'post_categories',
      fields: z.object({ sortOrder: z.number() }),
    }),
  },
});
const all = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

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

function setup() {
  const published: string[] = [];
  const built = framework({ family: AppUseCase })
    .collection(Categories, { access: all })
    .collection(Posts, { access: all })
    .build({
      store,
      events: {
        async publish(event: object) {
          if ('token' in event && typeof event.token === 'string')
            published.push(event.token);
        },
      },
    });
  const ctx = () =>
    built.context({
      actor: { userId: 'u1', organizationId: 'A' },
      logger: new NoopLogger(),
    });
  return { ...built, published, ctx };
}

describe('many() on MongoStore', () => {
  it('sets and lists links through build(), with ensure()’s join indexes', async () => {
    const { useCases, ctx, ensure, published } = setup();
    await ensure();
    const post = await useCases.posts.create.execute(ctx(), { title: 'p' });
    const c1 = await useCases.categories.create.execute(ctx(), { name: 'c1' });
    const c2 = await useCases.categories.create.execute(ctx(), { name: 'c2' });

    await useCases.posts.categories.set.execute(ctx(), {
      id: post.id,
      links: [
        { categoriesId: c1.id, sortOrder: 2 },
        { categoriesId: c2.id, sortOrder: 1 },
      ],
    });
    const { docs } = await useCases.posts.categories.list.execute(ctx(), {
      id: post.id,
      sort: ['sortOrder'],
    });

    expect(docs.map((link) => link.categoriesId)).toEqual([c2.id, c1.id]);
    expect(
      published.filter((token) => token === 'post_categories.created'),
    ).toHaveLength(2);
  });

  it('rolls set back when one write fails part way, and publishes nothing', async () => {
    const { useCases, ctx, repos, published } = setup();
    const post = await useCases.posts.create.execute(ctx(), { title: 'p' });
    const c1 = await useCases.categories.create.execute(ctx(), { name: 'c1' });
    const c2 = await useCases.categories.create.execute(ctx(), { name: 'c2' });
    // Two links with one sortOrder clash on a unique index: the second
    // insert fails after the first succeeded.
    await store.ensure('post_categories', [
      { fields: { sortOrder: 1 }, unique: true },
    ]);
    published.length = 0;

    const error = await useCases.posts.categories.set
      .execute(ctx(), {
        id: post.id,
        links: [
          { categoriesId: c1.id, sortOrder: 5 },
          { categoriesId: c2.id, sortOrder: 5 },
        ],
      })
      .catch((caught: unknown) => caught);

    expect(LatticeError.is(error) && error.code).toBe('CONFLICT');
    expect((await repos.post_categories.find({}, unscoped)).docs).toEqual([]);
    expect(published).toEqual([]);
  });
});
