import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import {
  collection,
  type Doc,
  family,
  framework,
  MemoryStore,
  many,
  ref,
  tenancy,
  type Withheld,
} from './index.js';
import type { StoredDoc } from './store.js';
import type { AnyWhere } from './where.js';

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

/** A MemoryStore that records each getMany, by collection. */
class SpyStore extends MemoryStore {
  readonly getManyCalls: string[] = [];
  override async getMany(
    collection: string,
    ids: readonly string[],
    where?: AnyWhere,
  ): Promise<StoredDoc[]> {
    this.getManyCalls.push(collection);
    return super.getMany(collection, ids, where);
  }
}

const AppUseCase = family({
  actor: z.object({
    userId: z.string(),
    organizationId: z.string(),
    support: z.boolean().optional(),
  }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

const tenant = 'organizationId';

// Users and Posts refer to each other by slug: no value cycle.
const Users = collection('users', {
  schema: z.object({
    name: z.string(),
    email: z.string(),
    pinnedPostId: ref('posts', { onDelete: 'nullify' }).optional(),
  }),
  tenant,
});

const Posts = collection('posts', {
  schema: z.object({
    title: z.string().min(1),
    status: z.enum(['draft', 'published']),
    authorId: ref('users'),
    reviewerIds: z.array(ref('users', { onDelete: 'nullify' })).max(10),
  }),
  tenant,
  relations: {
    categories: many('categories', {
      through: 'post_categories',
      fields: z.object({
        sortOrder: z.number().int().default(0),
        isPrimary: z.boolean().optional(),
      }),
    }),
  },
});

const Categories = collection('categories', {
  schema: z.object({ name: z.string(), hidden: z.boolean().default(false) }),
  tenant,
}).hooks({
  afterRead: ({ doc }) => ({ ...doc, name: doc.name.toUpperCase() }),
});

type User = Doc<typeof Users>;
type Post = Doc<typeof Posts>;
type Category = Doc<typeof Categories>;

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

function setup(options: { readonly usersRead?: boolean } = {}) {
  const store = new SpyStore();
  const built = framework({ family: AppUseCase })
    .collection(Users, {
      access: {
        ...open,
        // A user with a secret email is not readable: a Where on the target.
        read: () =>
          options.usersRead === false
            ? false
            : { email: { ne: 'secret@example.com' } },
      },
    })
    .collection(Posts, { access: open })
    .collection(Categories, {
      access: { ...open, read: () => ({ hidden: { eq: false } }) },
    })
    .build({ store, events: { publish: async (_event: object) => {} } });
  const client = (organizationId: string, support = false) =>
    createLocalClient(built.app, {
      context: {
        actor: { userId: 'u', organizationId, support },
        logger: new MemoryLogger(),
      },
    });
  return {
    ...built,
    store,
    a: client('A'),
    b: client('B'),
    support: client('S', true),
  };
}

async function seeded(options: { readonly usersRead?: boolean } = {}) {
  const s = setup(options);
  const { a, b } = s;
  const ada = await a.users.create({ name: 'Ada', email: 'ada@example.com' });
  const bob = await a.users.create({ name: 'Bob', email: 'bob@example.com' });
  const secret = await a.users.create({
    name: 'Sam',
    email: 'secret@example.com',
  });
  const other = await b.users.create({ name: 'Bea', email: 'bea@example.com' });
  const post = await a.posts.create({
    title: 'p',
    status: 'draft',
    authorId: ada.id,
    reviewerIds: [bob.id, secret.id, other.id, 'gone'],
  });
  const news = await a.categories.create({ name: 'news' });
  const hidden = await a.categories.create({ name: 'internal', hidden: true });
  await a.posts.categories.set({
    id: post.id,
    links: [
      { categoriesId: news.id, sortOrder: 1, isPrimary: true },
      { categoriesId: hidden.id, sortOrder: 2 },
    ],
  });
  s.store.getManyCalls.length = 0;
  return { ...s, ada, bob, secret, other, post, news, hidden };
}

describe('populate types', () => {
  const { a: local } = setup();

  it('get without populate gives the plain document', () => {
    typeOnly(async () => {
      const post = await local.posts.get({ id: 'p1' });
      expectTypeOf(post).toEqualTypeOf<Post>();
      expectTypeOf(post.authorId).toEqualTypeOf<string>();
    });
  });

  it('get with populate gives the target document, or its id when withheld', () => {
    typeOnly(async () => {
      const post = await local.posts.get({ id: 'p1', populate: ['authorId'] });
      expectTypeOf(post.authorId).toEqualTypeOf<User | Withheld>();
      expectTypeOf(post.title).toEqualTypeOf<string>();
      expectTypeOf(post.reviewerIds).toEqualTypeOf<string[]>();
      // Narrowing, not a cast: a withheld document has no other field.
      const author = 'email' in post.authorId ? post.authorId.email : null;
      expectTypeOf(author).toEqualTypeOf<string | null>();
    });
  });

  it('a list of ids populates element-wise', () => {
    typeOnly(async () => {
      const post = await local.posts.get({
        id: 'p1',
        populate: ['reviewerIds'],
      });
      expectTypeOf(post.reviewerIds).toEqualTypeOf<(User | Withheld)[]>();
    });
  });

  it('a many relation populates on get as links with their documents', () => {
    typeOnly(async () => {
      const post = await local.posts.get({
        id: 'p1',
        populate: ['authorId', 'categories'],
      });
      expectTypeOf(post.categories).toEqualTypeOf<
        {
          sortOrder: number;
          isPrimary?: boolean | undefined;
          doc: Category | Withheld;
        }[]
      >();
    });
  });

  it('an optional ref stays optional when populated', () => {
    typeOnly(async () => {
      const user = await local.users.get({
        id: 'u1',
        populate: ['pinnedPostId'],
      });
      expectTypeOf(user.pinnedPostId).toEqualTypeOf<
        Post | Withheld | undefined
      >();
    });
  });

  it('find populates each document', () => {
    typeOnly(async () => {
      const plain = await local.posts.find({ limit: 10 });
      expectTypeOf(plain.docs).toEqualTypeOf<Post[]>();
      const page = await local.posts.find({
        where: { status: { eq: 'published' } },
        populate: ['authorId'],
      });
      expectTypeOf(page.docs[0]?.authorId).toEqualTypeOf<
        User | Withheld | undefined
      >();
    });
  });

  it('a relation’s list populates its links’ refs', () => {
    typeOnly(async () => {
      const page = await local.posts.categories.list({
        id: 'p1',
        populate: ['categoriesId'],
      });
      expectTypeOf(page.docs[0]?.categoriesId).toEqualTypeOf<
        Category | Withheld | undefined
      >();
      expectTypeOf(page.docs[0]?.postsId).toEqualTypeOf<string | undefined>();
    });
  });

  it('populate names only refs, and relations only on get', () => {
    typeOnly(() => {
      // @ts-expect-error Type '"title"' is not assignable to type '"authorId" | "reviewerIds" | "categories"'
      local.posts.get({ id: 'p1', populate: ['title'] });
      // @ts-expect-error Type '"categories"' is not assignable to type '"authorId" | "reviewerIds"'
      local.posts.find({ populate: ['categories'] });
      // @ts-expect-error 'populate' does not exist
      local.categories.get({ id: 'c1', populate: ['name'] });
    });
  });

  it('a populate list held in a K[] variable gives the wide document', () => {
    typeOnly(async () => {
      const keys: ('authorId' | 'categories')[] = [];
      const post = await local.posts.get({ id: 'p1', populate: keys });
      expectTypeOf(post.authorId).toEqualTypeOf<string | User | Withheld>();
    });
  });
});

describe('populate', () => {
  it('get populates refs, lists and relations, with one getMany per target collection', async () => {
    const { a, store, post, ada, bob, secret, other, news, hidden } =
      await seeded();

    const got = await a.posts.get({
      id: post.id,
      populate: ['authorId', 'reviewerIds', 'categories'],
    });

    expect(got.authorId).toMatchObject({ id: ada.id, name: 'Ada' });
    expect(got.reviewerIds).toEqual([
      bob,
      // A Where on the target, another tenant and a gone document: ids only.
      { id: secret.id },
      { id: other.id },
      { id: 'gone' },
    ]);
    // Each target passes through its afterRead; a hidden one is withheld.
    const links = [...(got.categories ?? [])].sort(
      (x, y) => x.sortOrder - y.sortOrder,
    );
    expect(links).toEqual([
      { sortOrder: 1, isPrimary: true, doc: { ...news, name: 'NEWS' } },
      { sortOrder: 2, doc: { id: hidden.id } },
    ]);
    // authorId and reviewerIds share one getMany on users.
    expect(store.getManyCalls.sort()).toEqual(['categories', 'users']);
  });

  it('find populates every document on the page with one getMany per target', async () => {
    const { a, store, ada, bob } = await seeded();
    for (const [i, authorId] of [ada.id, bob.id, ada.id].entries()) {
      await a.posts.create({
        title: `t${i}`,
        status: 'published',
        authorId,
        reviewerIds: [bob.id],
      });
    }
    store.getManyCalls.length = 0;

    const first = await a.posts.find({
      where: { status: { eq: 'published' } },
      sort: ['title'],
      limit: 2,
      populate: ['authorId', 'reviewerIds'],
    });
    const rest = await a.posts.find({
      where: { status: { eq: 'published' } },
      sort: ['title'],
      limit: 2,
      after: first.next ?? '',
      populate: ['authorId'],
    });

    expect(
      [...first.docs, ...rest.docs].map((doc) =>
        'name' in doc.authorId ? doc.authorId.name : null,
      ),
    ).toEqual(['Ada', 'Bob', 'Ada']);
    expect(first.docs[0]?.reviewerIds).toEqual([bob]);
    expect(rest.docs[0]?.reviewerIds).toEqual([bob.id]);
    expect(store.getManyCalls).toEqual(['users', 'users']);
  });

  it('a plain read is unchanged and reads no other collection', async () => {
    const { a, store, post } = await seeded();
    const got = await a.posts.get({ id: post.id });
    expect(got.authorId).toBe(post.authorId);
    expect('categories' in got).toBe(false);
    expect(store.getManyCalls).toEqual([]);
  });

  it('a false read on the target withholds all of it, and the read still succeeds', async () => {
    const { a, post, ada } = await seeded({ usersRead: false });
    const got = await a.posts.get({
      id: post.id,
      populate: ['authorId', 'categories'],
    });
    expect(got.authorId).toEqual({ id: ada.id });
    expect(got.categories).toHaveLength(2);
  });

  it('a bypass populates across tenants', async () => {
    const { support, post, other } = await seeded();
    const got = await support.posts.get({
      id: post.id,
      populate: ['reviewerIds'],
    });
    expect(got.reviewerIds).toContainEqual(other);
  });

  it('list populates its links’ refs', async () => {
    const { a, post, news } = await seeded();
    const page = await a.posts.categories.list({
      id: post.id,
      sort: ['sortOrder'],
      populate: ['categoriesId'],
    });
    expect(page.docs.map((link) => link.categoriesId)).toEqual([
      { ...news, name: 'NEWS' },
      { id: page.docs[1]?.categoriesId.id },
    ]);
  });

  it('refuses a key it cannot populate with VALIDATION', async () => {
    const { a, post } = await seeded();
    const code = (call: Promise<unknown>) =>
      call.then(
        () => 'ok',
        (error) => (isPFError(error) ? error.code : error),
      );
    // @ts-expect-error find cannot populate a relation
    expect(await code(a.posts.find({ populate: ['categories'] }))).toBe(
      'VALIDATION',
    );
    // @ts-expect-error not a ref
    expect(await code(a.posts.get({ id: post.id, populate: ['title'] }))).toBe(
      'VALIDATION',
    );
  });

  it('a direct use case call populates and types as the client does', async () => {
    const { useCases, context, post, ada } = await seeded();
    const ctx = () =>
      context({
        actor: { userId: 'u', organizationId: 'A' },
        logger: new MemoryLogger(),
      });

    const plain = await useCases.posts.get.execute(ctx(), { id: post.id });
    expectTypeOf(plain).toEqualTypeOf<Post>();
    const got = await useCases.posts.get.execute(ctx(), {
      id: post.id,
      populate: ['authorId'],
    });
    expectTypeOf(got.authorId).toEqualTypeOf<User | Withheld>();
    expect(got.authorId).toEqual(ada);
  });
});

describe('a crm-sized definition', () => {
  const Companies = collection('companies', {
    schema: z.object({
      name: z.string(),
      ownerId: ref('people'),
      parentId: ref('companies', { onDelete: 'nullify' }).optional(),
    }),
    tenant,
    relations: {
      tags: many('labels', {
        through: 'company_labels',
        fields: z.object({ sortOrder: z.number() }),
      }),
    },
  });
  const People = collection('people', {
    schema: z.object({
      name: z.string(),
      companyId: ref('companies'),
      managerId: ref('people', { onDelete: 'nullify' }).optional(),
    }),
    tenant,
  });
  const Contacts = collection('contacts', {
    schema: z.object({
      email: z.string(),
      companyId: ref('companies'),
      ownerId: ref('people'),
    }),
    tenant,
  });
  const Deals = collection('deals', {
    schema: z.object({
      title: z.string(),
      amount: z.number(),
      stage: z.enum(['lead', 'won', 'lost']),
      companyId: ref('companies'),
      contactId: ref('contacts', { onDelete: 'nullify' }).nullable(),
    }),
    tenant,
  });
  const Labels = collection('labels', {
    schema: z.object({
      name: z.string(),
      createdById: ref('people'),
      dealId: ref('deals', { onDelete: 'nullify' }).optional(),
    }),
    tenant,
  });
  const read = { read: () => true };

  const { app } = framework({ family: AppUseCase })
    .collection(Companies, {
      access: { read: ({ actor }) => ({ ownerId: { eq: actor.userId } }) },
    })
    .collection(People, { access: read })
    .collection(Contacts, {
      access: {
        read: () => true,
        update: ({ actor }) => ({ ownerId: { eq: actor.userId } }),
      },
    })
    .collection(Deals, {
      access: {
        read: () => true,
        update: ({ actor }) => ({
          or: [{ stage: { eq: 'lead' } }, { companyId: { eq: actor.userId } }],
        }),
      },
    })
    .collection(Labels, { access: read })
    .build({
      store: new MemoryStore(),
      events: { publish: async (_event: object) => {} },
    });
  const client = createLocalClient(app, {
    context: {
      actor: { userId: 'u', organizationId: 'A' },
      logger: new MemoryLogger(),
    },
  });

  it('reads and populates across all five', () => {
    typeOnly(async () => {
      const deal = await client.deals.get({
        id: 'd1',
        populate: ['companyId', 'contactId'],
      });
      expectTypeOf(deal.contactId).toEqualTypeOf<
        Doc<typeof Contacts> | Withheld | null
      >();
      const company = await client.companies.get({
        id: 'c1',
        populate: ['ownerId', 'parentId', 'tags'],
      });
      expectTypeOf(company.parentId).toEqualTypeOf<
        Doc<typeof Companies> | Withheld | undefined
      >();
      expectTypeOf(company.tags).toEqualTypeOf<
        { sortOrder: number; doc: Doc<typeof Labels> | Withheld }[]
      >();
      const label = await client.labels.get({ id: 'l1', populate: ['dealId'] });
      expectTypeOf(label.dealId).toEqualTypeOf<
        Doc<typeof Deals> | Withheld | undefined
      >();
      const person = await client.people.get({ id: 'x' });
      expectTypeOf(person.managerId).toEqualTypeOf<string | undefined>();
      const contact = await client.contacts.get({
        id: 'c1',
        populate: ['ownerId'],
      });
      expectTypeOf(contact.ownerId).toEqualTypeOf<
        Doc<typeof People> | Withheld
      >();
    });
  });
});

describe('an overridden read', () => {
  class ListedPosts extends AppUseCase('posts.find', { collection: Posts }) {
    async execute() {
      return { docs: [], next: null };
    }
  }

  it('is plain: the override serves it, and takes no populate', () => {
    const { app } = framework({ family: AppUseCase })
      .collection(Users, { access: open })
      .collection(Posts, { access: open, overrides: { find: ListedPosts } })
      .collection(Categories, { access: open })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
        overrides: () => ({ posts: { find: new ListedPosts() } }),
      });
    const local = createLocalClient(app, {
      context: {
        actor: { userId: 'u', organizationId: 'A' },
        logger: new MemoryLogger(),
      },
    });
    typeOnly(async () => {
      // @ts-expect-error 'populate' does not exist: find is overridden
      await local.posts.find({ populate: ['authorId'] });
      const post = await local.posts.get({ id: 'p', populate: ['authorId'] });
      expectTypeOf(post.authorId).toEqualTypeOf<User | Withheld>();
    });
  });
});
