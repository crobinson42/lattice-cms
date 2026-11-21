import { NoopLogger } from '@hexok/logger';
import {
  collection,
  family,
  framework,
  many,
  ref,
  tenancy,
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
const Users = collection('users', {
  schema: z.object({ name: z.string(), hidden: z.boolean() }),
  tenant,
});
const Categories = collection('categories', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Posts = collection('posts', {
  schema: z.object({
    title: z.string(),
    authorId: ref('users'),
    reviewerIds: z.array(ref('users', { onDelete: 'nullify' })),
  }),
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

describe('populate on MongoStore', () => {
  it('populates refs, lists and relations through build(), under access and tenancy', async () => {
    const { useCases, repos, context } = framework({ family: AppUseCase })
      .collection(Users, {
        access: { ...all, read: () => ({ hidden: { eq: false } }) },
      })
      .collection(Categories, { access: all })
      .collection(Posts, { access: all })
      .build({ store, events: { publish: async (_event: object) => {} } });
    const ctx = () =>
      context({
        actor: { userId: 'u1', organizationId: 'A' },
        logger: new NoopLogger(),
      });
    const ada = await useCases.users.create.execute(ctx(), {
      name: 'Ada',
      hidden: false,
    });
    const sam = await useCases.users.create.execute(ctx(), {
      name: 'Sam',
      hidden: true,
    });
    const other = await repos.users.insert(
      { name: 'Bea', hidden: false },
      tenancy.scope(Users, 'B'),
    );
    const news = await useCases.categories.create.execute(ctx(), {
      name: 'news',
    });
    const post = await useCases.posts.create.execute(ctx(), {
      title: 'p',
      authorId: ada.id,
      reviewerIds: [sam.id, other.id, ada.id],
    });
    await useCases.posts.categories.set.execute(ctx(), {
      id: post.id,
      links: [{ categoriesId: news.id, sortOrder: 1 }],
    });

    const got = await useCases.posts.get.execute(ctx(), {
      id: post.id,
      populate: ['authorId', 'reviewerIds', 'categories'],
    });
    const page = await useCases.posts.find.execute(ctx(), {
      populate: ['authorId'],
    });

    expect(got.authorId).toEqual(ada);
    expect(got.reviewerIds).toEqual([{ id: sam.id }, { id: other.id }, ada]);
    expect(got.categories).toEqual([{ sortOrder: 1, doc: news }]);
    expect(page.docs.map((doc) => doc.authorId)).toEqual([ada]);
  });
});
