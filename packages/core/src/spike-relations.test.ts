import { createLocalClient } from '@ts-pf/server';
import { describe, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { callContext } from './fixtures/context.js';
import {
  collection,
  type Doc,
  family,
  framework,
  many,
  ref,
  type Withheld,
} from './fixtures/spike-relations.js';
import { MemoryStore, type tenancy, type Where } from './index.js';

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

const AppUseCase = family({
  actor: z.object({
    userId: z.string(),
    organizationId: z.string(),
    roles: z.array(z.string()),
  }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});

// Users and Posts refer to each other by slug: no value cycle.
const Users = collection('users', {
  schema: z.object({
    name: z.string(),
    email: z.string(),
    pinnedPostId: ref('posts').optional(),
  }),
  tenant: 'organizationId',
});

const Posts = collection('posts', {
  schema: z.object({
    title: z.string().min(1),
    body: z.string(),
    status: z.enum(['draft', 'published']),
    authorId: ref('users'),
  }),
  tenant: 'organizationId',
  relations: {
    categories: many('categories', {
      through: 'post_categories',
      fields: z.object({ sortOrder: z.number().int(), isPrimary: z.boolean() }),
    }),
  },
});

const Categories = collection('categories', {
  schema: z.object({ name: z.string() }),
  tenant: 'organizationId',
});

type User = {
  name: string;
  email: string;
  pinnedPostId?: string | undefined;
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
};

type Post = {
  title: string;
  body: string;
  status: 'draft' | 'published';
  authorId: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
};

type Category = {
  name: string;
  id: string;
  createdAt: string;
  updatedAt: string;
  organizationId: string;
};

const lattice = framework({ family: AppUseCase })
  .collection(Users, { access: { read: () => true } })
  .collection(Posts, {
    access: {
      read: () => true,
      create: ({ actor }) => actor.roles.includes('writer'),
      update: ({ actor }) => ({ authorId: { eq: actor.userId } }),
      delete: ({ actor }) => actor.roles.includes('admin'),
    },
  })
  .collection(Categories);

const { app } = lattice.build({ store: new MemoryStore() });

const context = {
  ...callContext(),
  actor: { userId: 'u1', organizationId: 'o1', roles: [] },
};

/** ts-pf's own client: one output type per procedure. */
const raw = createLocalClient(app, { context });

/** Option (c): the same object, typed so reads follow `populate`. */
const local = lattice.client(createLocalClient(app, { context }));

describe('ref() and many()', () => {
  it('a ref is a string field that names its target slug', () => {
    expectTypeOf(Posts.schema.shape.authorId['~ref']).toEqualTypeOf<'users'>();
    expectTypeOf<
      z.output<typeof Posts.schema>['authorId']
    >().toEqualTypeOf<string>();
  });

  it('many() names its target, its join collection and its link fields', () => {
    expectTypeOf(
      Posts.relations.categories.target,
    ).toEqualTypeOf<'categories'>();
    expectTypeOf(
      Posts.relations.categories.through,
    ).toEqualTypeOf<'post_categories'>();
  });

  it('many() gives <slug>.<relation>.list and .set', () => {
    // Type-only: the spike builds no runtime for relation procedures.
    typeOnly(() => {
      expectTypeOf(local.posts.categories.list).parameter(0).toEqualTypeOf<{
        readonly id: string;
        readonly limit?: number;
        readonly after?: string;
      }>();
      expectTypeOf(local.posts.categories.list).returns.resolves.toEqualTypeOf<{
        docs: {
          sortOrder: number;
          isPrimary: boolean;
          id: string;
          createdAt: string;
          updatedAt: string;
          postsId: string;
          categoriesId: string;
        }[];
        next: string | null;
      }>();
      expectTypeOf(local.posts.categories.set).parameter(0).toEqualTypeOf<{
        readonly id: string;
        readonly links: readonly {
          sortOrder: number;
          isPrimary: boolean;
          categoriesId: string;
        }[];
      }>();
    });
  });

  it('a ref to a slug the framework lacks fails build()', () => {
    const Comments = collection('comments', {
      schema: z.object({ postId: ref('postz'), text: z.string() }),
    });
    const broken = framework({ family: AppUseCase })
      .collection(Posts)
      .collection(Users)
      .collection(Categories)
      .collection(Comments);
    typeOnly(() =>
      // @ts-expect-error comments.postId refers to "postz", which is not a collection of this framework
      broken.build({ store: new MemoryStore() }),
    );
  });
});

describe('tenant', () => {
  it('is in the stored document, and not in create or update input', () => {
    expectTypeOf<Doc<typeof Posts>>().toEqualTypeOf<Post>();
    expectTypeOf(local.posts.create).parameter(0).toEqualTypeOf<{
      title: string;
      body: string;
      status: 'draft' | 'published';
      authorId: string;
    }>();
    typeOnly(() => {
      local.posts.create({
        title: 't',
        body: 'b',
        status: 'draft',
        authorId: 'u1',
        // @ts-expect-error create stamps the tenant field
        organizationId: 'o2',
      });
      // @ts-expect-error clients cannot change the tenant field
      local.posts.update({ id: 'p1', organizationId: 'o2' });
    });
  });

  it('tenantOf is typed from the actor', () => {
    expectTypeOf(AppUseCase.tenantOf).toEqualTypeOf<
      | ((actor: {
          userId: string;
          organizationId: string;
          roles: string[];
        }) => string | typeof tenancy.bypass)
      | undefined
    >();
  });

  it('a schema field cannot be the tenant field', () => {
    typeOnly(() =>
      // @ts-expect-error tenant "organizationId" is stamped by Lattice; remove it from the schema
      collection('notes', {
        schema: z.object({ organizationId: z.string() }),
        tenant: 'organizationId',
      }),
    );
  });
});

describe('access', () => {
  it('each function gets the app actor and returns boolean or a Where on the collection', () => {
    framework({ family: AppUseCase }).collection(Posts, {
      access: {
        update: ({ actor }) => {
          expectTypeOf(actor).toEqualTypeOf<{
            userId: string;
            organizationId: string;
            roles: string[];
          }>();
          return { authorId: { eq: actor.userId } } satisfies Where<Post>;
        },
      },
    });
  });

  it('a Where on an unknown field is a type error that names it', () => {
    typeOnly(() =>
      // @ts-expect-error access.update filters on "authorID", which posts does not have
      framework({ family: AppUseCase }).collection(Posts, {
        access: {
          update: ({ actor }) => ({
            status: { eq: 'draft' },
            authorID: { eq: actor.userId },
          }),
        },
      }),
    );
    typeOnly(() =>
      framework({ family: AppUseCase }).collection(Posts, {
        // @ts-expect-error "equals" is not an operator: no properties in common with FieldWhere<string>
        access: { read: async () => ({ title: { equals: 'x' } }) },
      }),
    );
  });

  it('an operand of the wrong type, an unknown action and a Where on create are type errors', () => {
    typeOnly(() => {
      framework({ family: AppUseCase }).collection(Posts, {
        // @ts-expect-error status is 'draft' | 'published'
        access: { read: () => ({ status: { eq: 'archived' } }) },
      });
      // @ts-expect-error "publish" is not an action of posts
      framework({ family: AppUseCase }).collection(Posts, {
        access: { publish: () => true },
      });
      framework({ family: AppUseCase }).collection(Posts, {
        // @ts-expect-error create has no row to filter
        access: { create: () => ({ status: { eq: 'draft' } }) },
      });
    });
  });
});

describe('populate', () => {
  it('ts-pf alone: one output type, whatever populate says', () => {
    typeOnly(async () => {
      const plain = await raw.posts.get({ id: 'p1' });
      const populated = await raw.posts.get({
        id: 'p1',
        populate: ['authorId'],
      });
      expectTypeOf(plain.authorId).toEqualTypeOf<string | User | Withheld>();
      expectTypeOf(populated.authorId).toEqualTypeOf<
        string | User | Withheld
      >();
    });
  });

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
      // Narrowing, not a cast: a withheld document has no other field.
      const author = 'email' in post.authorId ? post.authorId.email : null;
      expectTypeOf(author).toEqualTypeOf<string | null>();
    });
  });

  it('a many relation populates as links with their documents', () => {
    typeOnly(async () => {
      const post = await local.posts.get({
        id: 'p1',
        populate: ['authorId', 'categories'],
      });
      expectTypeOf(post.categories).toEqualTypeOf<
        {
          sortOrder: number;
          isPrimary: boolean;
          readonly doc: Category | Withheld;
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

  it('populate names only relations', () => {
    typeOnly(() => {
      // @ts-expect-error Type '"title"' is not assignable to type '"authorId" | "categories"'
      local.posts.get({ id: 'p1', populate: ['title'] });
      // @ts-expect-error 'populate' does not exist in type 'Flat<{ readonly id: string; }>'
      local.categories.get({ id: 'c1', populate: ['name'] });
    });
  });
});

/**
 * A definition the size of examples/crm, for the type-check timing: five
 * collections, two refs each, one many().
 */
describe('crm-sized definition', () => {
  const tenanted = { tenant: 'organizationId' } as const;
  const Companies = collection('companies', {
    schema: z.object({
      name: z.string(),
      ownerId: ref('people'),
      parentId: ref('companies').optional(),
    }),
    ...tenanted,
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
      managerId: ref('people').optional(),
    }),
    ...tenanted,
  });
  const Contacts = collection('contacts', {
    schema: z.object({
      email: z.string(),
      companyId: ref('companies'),
      ownerId: ref('people'),
    }),
    ...tenanted,
  });
  const Deals = collection('deals', {
    schema: z.object({
      title: z.string(),
      amount: z.number(),
      stage: z.enum(['lead', 'won', 'lost']),
      companyId: ref('companies'),
      contactId: ref('contacts').nullable(),
    }),
    ...tenanted,
  });
  const Labels = collection('labels', {
    schema: z.object({
      name: z.string(),
      createdById: ref('people'),
      dealId: ref('deals').optional(),
    }),
    ...tenanted,
  });

  const crm = framework({ family: AppUseCase })
    .collection(Companies, {
      access: { read: ({ actor }) => ({ ownerId: { eq: actor.userId } }) },
    })
    .collection(People, { access: { read: () => true } })
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
    .collection(Labels);

  const client = crm.client(
    createLocalClient(crm.build({ store: new MemoryStore() }).app, { context }),
  );

  it('reads and populates across all five', () => {
    typeOnly(async () => {
      const deal = await client.deals.get({
        id: 'd1',
        populate: ['companyId', 'contactId'],
      });
      expectTypeOf(deal.contactId).toEqualTypeOf<
        Doc<typeof Contacts> | Withheld | null
      >();
      const companies = await client.companies.find({
        populate: ['ownerId', 'parentId', 'tags'],
      });
      expectTypeOf(companies.docs[0]?.tags).toEqualTypeOf<
        | { sortOrder: number; readonly doc: Doc<typeof Labels> | Withheld }[]
        | undefined
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
