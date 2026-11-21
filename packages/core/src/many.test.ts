import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase } from './fixtures/context.js';
import {
  collection,
  type Doc,
  family,
  framework,
  MemoryStore,
  many,
  tenancy,
  unscoped,
} from './index.js';

const Tenanted = family({
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
const Categories = collection('categories', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Tags = collection('tags', {
  schema: z.object({ name: z.string() }),
  tenant,
});
const Posts = collection('posts', {
  schema: z.object({
    title: z.string(),
    status: z.enum(['draft', 'published', 'hidden']),
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
    tags: many('tags', { through: 'post_tags', onDelete: 'cascade' }),
  },
});

type Link = Doc<typeof Posts.relations.categories.through>;

const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/** The code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

function setup() {
  const published: { token: string; payload: Record<string, unknown> }[] = [];
  const built = framework({ family: Tenanted })
    .collection(Categories, { access: open })
    .collection(Tags, { access: open })
    .collection(Posts, {
      access: {
        ...open,
        read: () => ({ status: { ne: 'hidden' } }),
        update: () => ({ status: { eq: 'draft' } }),
      },
    })
    .build({
      store: new MemoryStore(),
      events: {
        async publish(event: object) {
          if (
            'token' in event &&
            typeof event.token === 'string' &&
            'payload' in event &&
            typeof event.payload === 'object' &&
            event.payload !== null
          ) {
            published.push({
              token: event.token,
              payload: { ...event.payload },
            });
          }
        },
      },
    });
  const client = (organizationId: string, support = false) =>
    createLocalClient(built.app, {
      context: {
        actor: { userId: 'u1', organizationId, support },
        logger: new MemoryLogger(),
      },
    });
  return {
    ...built,
    published,
    a: client('A'),
    b: client('B'),
    support: client('S', true),
  };
}

async function seeded() {
  const s = setup();
  const { a } = s;
  const post = await a.posts.create({ title: 'p', status: 'draft' });
  const [c1, c2, c3] = await Promise.all(
    ['c1', 'c2', 'c3'].map((name) => a.categories.create({ name })),
  );
  if (c1 === undefined || c2 === undefined || c3 === undefined) {
    throw new Error('seed');
  }
  s.published.length = 0;
  return { ...s, post, c1, c2, c3 };
}

describe('many()', () => {
  it('derives the join collection: slug, refs, fields, tenant, indexes and events', () => {
    const join = Posts.relations.categories.through;
    expect(join.slug).toBe('post_categories');
    expect(join.tenant).toBe('organizationId');
    expect(join.refs).toEqual([
      {
        field: 'postsId',
        slug: 'posts',
        onDelete: 'cascade',
        array: false,
        cleared: null,
      },
      {
        field: 'categoriesId',
        slug: 'categories',
        onDelete: 'restrict',
        array: false,
        cleared: null,
      },
    ]);
    // The pair index serves postsId lookups by its prefix; categoriesId has its own.
    expect(join.indexes).toEqual([
      {
        fields: { organizationId: 1, postsId: 1, categoriesId: 1 },
        unique: true,
      },
      { fields: { organizationId: 1, categoriesId: 1 } },
    ]);
    expectTypeOf<Link>().toEqualTypeOf<{
      postsId: string;
      categoriesId: string;
      sortOrder: number;
      isPrimary?: boolean | undefined;
      id: string;
      createdAt: string;
      updatedAt: string;
      organizationId: string;
    }>();
  });

  it('types list and set on the client, and exposes the join collection’s repo', () => {
    const { a, repos } = setup();
    expectTypeOf(a.posts.categories.set).parameter(0).toEqualTypeOf<{
      id: string;
      links: {
        categoriesId: string;
        sortOrder?: number | undefined;
        isPrimary?: boolean | undefined;
      }[];
    }>();
    expectTypeOf(a.posts.categories.list).returns.resolves.toEqualTypeOf<{
      docs: Link[];
      next: string | null;
    }>();
    expectTypeOf(a.posts.tags.set).returns.resolves.toEqualTypeOf<{
      docs: Doc<typeof Posts.relations.tags.through>[];
    }>();
    expect(typeof repos.post_categories.find).toBe('function');
  });
});

describe('set', () => {
  it('inserts, updates and deletes by diff, keeps unchanged links, and returns them in input order', async () => {
    const { a, post, c1, c2, c3, published } = await seeded();

    const first = await a.posts.categories.set({
      id: post.id,
      links: [{ categoriesId: c2.id }, { categoriesId: c1.id, sortOrder: 1 }],
    });
    expect(
      first.docs.map((link) => [link.categoriesId, link.sortOrder]),
    ).toEqual([
      [c2.id, 0],
      [c1.id, 1],
    ]);
    expect(first.docs[0]).toMatchObject({
      postsId: post.id,
      organizationId: 'A',
    });
    expect(published.map(({ token }) => token)).toEqual([
      'post_categories.created',
      'post_categories.created',
    ]);
    published.length = 0;

    const second = await a.posts.categories.set({
      id: post.id,
      links: [
        { categoriesId: c3.id },
        { categoriesId: c2.id, isPrimary: true },
      ],
    });
    expect(second.docs.map((link) => link.categoriesId)).toEqual([
      c3.id,
      c2.id,
    ]);
    // c2 is the same link, changed: its id and createdAt stay.
    expect(second.docs[1]).toMatchObject({
      id: first.docs[0]?.id,
      createdAt: first.docs[0]?.createdAt,
      isPrimary: true,
    });
    expect(published.map(({ token }) => token).sort()).toEqual([
      'post_categories.created',
      'post_categories.deleted',
      'post_categories.updated',
    ]);
    expect(published[0]?.payload).toMatchObject({
      actorId: 'u1',
      tenantId: 'A',
    });
    published.length = 0;

    const third = await a.posts.categories.set({
      id: post.id,
      links: [
        { categoriesId: c3.id },
        { categoriesId: c2.id, isPrimary: true },
      ],
    });
    expect(third.docs).toEqual(second.docs);
    expect(published).toEqual([]);

    await a.posts.categories.set({ id: post.id, links: [] });
    expect((await a.posts.categories.list({ id: post.id })).docs).toEqual([]);
  });

  it('refuses a repeated target and more than 1000 links with VALIDATION', async () => {
    const { a, post, c1 } = await seeded();

    const repeated = await a.posts.categories
      .set({
        id: post.id,
        links: [{ categoriesId: c1.id }, { categoriesId: c1.id }],
      })
      .catch((caught: unknown) => caught);
    expect(
      isPFError(repeated) && repeated.code === 'VALIDATION' && repeated.data,
    ).toMatchObject({
      issues: [{ path: ['links', 1, 'categoriesId'] }],
    });

    const tooMany = Array.from({ length: 1001 }, (_, i) => ({
      categoriesId: `c${i}`,
    }));
    expect(
      await codeOf(a.posts.categories.set({ id: post.id, links: tooMany })),
    ).toBe('VALIDATION');
  });

  it('runs the parent’s update access: a parent outside it is NOT_FOUND', async () => {
    const { a, c1 } = await seeded();
    const published = await a.posts.create({
      title: 'live',
      status: 'published',
    });

    expect(
      await codeOf(
        a.posts.categories.set({
          id: published.id,
          links: [{ categoriesId: c1.id }],
        }),
      ),
    ).toBe('NOT_FOUND');
    // list runs read, which allows a published post.
    expect(await codeOf(a.posts.categories.list({ id: published.id }))).toBe(
      'ok',
    );
  });
});

describe('list', () => {
  it('pages, sorts and filters the links', async () => {
    const { a, post, c1, c2, c3 } = await seeded();
    await a.posts.categories.set({
      id: post.id,
      links: [
        { categoriesId: c1.id, sortOrder: 3 },
        { categoriesId: c2.id, sortOrder: 1, isPrimary: true },
        { categoriesId: c3.id, sortOrder: 2 },
      ],
    });

    const first = await a.posts.categories.list({
      id: post.id,
      sort: ['sortOrder'],
      limit: 2,
    });
    const rest = await a.posts.categories.list({
      id: post.id,
      sort: ['sortOrder'],
      limit: 2,
      after: first.next ?? '',
    });
    expect(
      [...first.docs, ...rest.docs].map((link) => link.categoriesId),
    ).toEqual([c2.id, c3.id, c1.id]);
    expect(rest.next).toBeNull();
    const primary = await a.posts.categories.list({
      id: post.id,
      where: { isPrimary: { eq: true } },
    });
    expect(primary.docs.map((link) => link.categoriesId)).toEqual([c2.id]);
  });

  it('runs the parent’s read access: false is FORBIDDEN, and a parent outside a Where is NOT_FOUND', async () => {
    const { a, post } = await seeded();
    const hidden = await a.posts.create({ title: 'h', status: 'hidden' });
    expect(await codeOf(a.posts.categories.list({ id: hidden.id }))).toBe(
      'NOT_FOUND',
    );

    const { app } = framework({ family: Tenanted })
      .collection(Categories, { access: open })
      .collection(Tags, { access: open })
      .collection(Posts, { access: { ...open, read: () => false } })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
      });
    const denied = createLocalClient(app, {
      context: {
        actor: { userId: 'u', organizationId: 'A' },
        logger: new MemoryLogger(),
      },
    });
    expect(await codeOf(denied.posts.categories.list({ id: post.id }))).toBe(
      'FORBIDDEN',
    );
  });
});

describe('tenancy', () => {
  it('another tenant’s parent is NOT_FOUND; a bypass lists across tenants and cannot set', async () => {
    const { a, b, support, post, c1 } = await seeded();
    await a.posts.categories.set({
      id: post.id,
      links: [{ categoriesId: c1.id }],
    });

    expect(await codeOf(b.posts.categories.list({ id: post.id }))).toBe(
      'NOT_FOUND',
    );
    expect(
      await codeOf(b.posts.categories.set({ id: post.id, links: [] })),
    ).toBe('NOT_FOUND');
    expect(
      (await support.posts.categories.list({ id: post.id })).docs,
    ).toHaveLength(1);
    expect(
      await codeOf(support.posts.categories.set({ id: post.id, links: [] })),
    ).toBe('FORBIDDEN');
  });
});

describe('onDelete', () => {
  it('deleting the parent cascades its links', async () => {
    const { a, repos, post, c1, c2, published } = await seeded();
    await a.posts.categories.set({
      id: post.id,
      links: [{ categoriesId: c1.id }, { categoriesId: c2.id }],
    });
    published.length = 0;

    await a.posts.delete({ id: post.id });

    expect((await repos.post_categories.find({}, unscoped)).docs).toEqual([]);
    expect(published.map(({ token }) => token)).toEqual([
      'post_categories.deleted',
      'post_categories.deleted',
      'posts.deleted',
    ]);
  });

  it('deleting a target restricts by default, or cascades its links', async () => {
    const { a, repos, post, c1 } = await seeded();
    const tag = await a.tags.create({ name: 't' });
    await a.posts.categories.set({
      id: post.id,
      links: [{ categoriesId: c1.id }],
    });
    await a.posts.tags.set({ id: post.id, links: [{ tagsId: tag.id }] });

    const error = await a.categories
      .delete({ id: c1.id })
      .catch((caught: unknown) => caught);
    expect(isPFError(error) && error.data).toEqual({
      collection: 'categories',
      id: c1.id,
      by: { collection: 'post_categories', field: 'categoriesId' },
    });

    await a.tags.delete({ id: tag.id });
    expect((await repos.post_tags.find({}, unscoped)).docs).toEqual([]);
    expect((await a.posts.tags.list({ id: post.id })).docs).toEqual([]);
  });
});

describe('overrides and names', () => {
  const Shelves = collection('shelves', {
    schema: z.object({ name: z.string() }),
  });
  const Books = collection('books', {
    schema: z.object({ title: z.string() }),
    relations: { shelves: many('shelves', { through: 'book_shelves' }) },
  });

  class FixedSet extends AppUseCase('books.shelves.set', {
    collection: Books,
  }) {
    async execute() {
      return { docs: [] };
    }
  }

  it('overrides a relation operation by name, with its instance', async () => {
    const { app } = framework({ family: AppUseCase })
      .collection(Shelves, { access: open })
      .collection(Books, {
        access: open,
        overrides: { shelves: { set: FixedSet } },
      })
      .build({
        store: new MemoryStore(),
        events: { publish: async (_event: object) => {} },
        overrides: () => ({ books: { shelves: { set: new FixedSet() } } }),
      });
    const local = createLocalClient(app, {
      context: {
        actor: { userId: 'u1', roles: [] },
        logger: new MemoryLogger(),
      },
    });
    const book = await local.books.create({ title: 'b' });

    expect(
      await local.books.shelves.set({
        id: book.id,
        links: [{ shelvesId: 'x' }],
      }),
    ).toEqual({ docs: [] });
  });

  it('a relation named like a field or an action, or of a collection to itself', () => {
    expect(() =>
      // @ts-expect-error relation "title" has the name of a field, an action or an access key
      collection('notes', {
        schema: z.object({ title: z.string() }),
        relations: { title: many('tags', { through: 'note_tags' }) },
      }),
    ).toThrow(
      'relation "title" has the name of a field, an action or an access key',
    );
    expect(() =>
      // @ts-expect-error relation "find" has the name of a field, an action or an access key
      collection('notes', {
        schema: z.object({ text: z.string() }),
        relations: { find: many('tags', { through: 'note_tags' }) },
      }),
    ).toThrow('relation "find" has the name');
    expect(() =>
      // @ts-expect-error friends relates users to itself, which many() does not support
      collection('users', {
        schema: z.object({ name: z.string() }),
        relations: { friends: many('users', { through: 'friendships' }) },
      }),
    ).toThrow('friends relates users to itself');
  });

  it('a method named like a relation, and a join slug already in use', () => {
    class ShelvesMethod extends AppUseCase('books.shelves', {
      collection: Books,
      input: z.object({}),
      output: z.object({}),
    }) {
      async execute() {
        return {};
      }
    }
    expect(() =>
      framework({ family: AppUseCase })
        .collection(Shelves, { access: open })
        .collection(Books, {
          access: { ...open, shelves: () => true },
          // @ts-expect-error "shelves" is a generated operation, an access key, a relation, a ts-pf implementer key, or has a dot
          methods: { shelves: ShelvesMethod },
        }),
    ).toThrow('"books.shelves" cannot be a method name');

    const Taken = collection('book_shelves', {
      schema: z.object({ x: z.string() }),
    });
    expect(() =>
      framework({ family: AppUseCase })
        .collection(Taken, { access: open })
        // @ts-expect-error the join collection "book_shelves" is already a collection
        .collection(Books, { access: open }),
    ).toThrow('the join collection "book_shelves" is already a collection');
  });
});
