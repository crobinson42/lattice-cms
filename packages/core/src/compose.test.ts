import { type Logger, MemoryLogger } from '@hexok/logger';
import { createLocalClient } from '@ts-pf/server';
import type { EventInstance } from 'hexok';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { z } from 'zod';
import { LatticeError } from './errors.js';
import { ArchivePost } from './fixtures/archive-post.js';
import { Comments } from './fixtures/comments.js';
import {
  AppUseCase,
  actor,
  allowAll,
  callContext,
} from './fixtures/context.js';
import { AppEvents, MemoryEventPublisher } from './fixtures/events.js';
import { Posts } from './fixtures/posts.js';
import { PublishPost } from './fixtures/publish-post.js';
import { framework, MemoryStore, type Repo, unscoped } from './index.js';

type Post = z.output<typeof Posts.output>;

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

const draft = { title: 't', body: 'b', status: 'draft' } as const;

/** The definition of architecture.md: one override, one method, two collections. */
const definition = framework({ family: AppUseCase })
  .collection(Posts, {
    access: { ...allowAll, publish: () => true },
    methods: { publish: PublishPost },
    overrides: { delete: ArchivePost },
  })
  .collection(Comments, { access: allowAll });

/** The definition wired to a store and a publisher. */
function setup(store = new MemoryStore()) {
  const events = new MemoryEventPublisher();
  const built = definition.build({
    store,
    events,
    methods: ({ repos }) => ({
      posts: { publish: new PublishPost({ posts: repos.posts }) },
    }),
    overrides: ({ repos }) => ({
      posts: { delete: new ArchivePost({ posts: repos.posts }) },
    }),
  });
  return {
    ...built,
    store,
    events,
    local: createLocalClient(built.app, { context: callContext() }),
  };
}

/** The LatticeError code `execute` throws, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) => (LatticeError.is(error) ? error.code : error),
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the definition', () => {
  it('has a contract with no store or publisher, the same object on every read', () => {
    const plain = framework({ family: AppUseCase }).collection(Posts, {
      access: allowAll,
    });
    expect(plain.contract).toBe(plain.contract);
    expect(Object.keys(definition.contract)).toEqual(['posts', 'comments']);
    expect(Object.keys(definition.contract.posts)).toEqual([
      'find',
      'get',
      'create',
      'update',
      'delete',
      'publish',
    ]);
  });
});

describe('the repos build() gives the factories', () => {
  it('are the repos build() returns, typed by collection', () => {
    let given: Repo<typeof Posts> | undefined;
    const { repos } = definition.build({
      store: new MemoryStore(),
      events: new MemoryEventPublisher(),
      methods: ({ repos }) => {
        given = repos.posts;
        expectTypeOf(repos.comments).toEqualTypeOf<Repo<typeof Comments>>();
        return { posts: { publish: new PublishPost({ posts: repos.posts }) } };
      },
      overrides: ({ repos }) => {
        expect(repos.posts).toBe(given);
        return { posts: { delete: new ArchivePost({ posts: repos.posts }) } };
      },
    });
    expect(given).toBe(repos.posts);
    expectTypeOf(repos.posts).toEqualTypeOf<Repo<typeof Posts>>();
  });

  it('hold only the collections the app added', () => {
    const { repos } = framework({ family: AppUseCase })
      .collection(Posts, { access: allowAll })
      .build({ store: new MemoryStore(), events: new MemoryEventPublisher() });
    expect(Object.keys(repos)).toEqual(['posts']);
    typeOnly(() => {
      // @ts-expect-error comments was not added
      void repos.comments;
    });
  });
});

describe('a repo', () => {
  it('insert stamps id, createdAt and updatedAt, and get returns the doc', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { repos } = setup();

    const post = await repos.posts.insert(draft, unscoped);

    expect(post).toEqual({
      ...draft,
      id: expect.any(String),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await repos.posts.get(post.id, unscoped)).toEqual(post);
    expect(await repos.posts.get('nope', unscoped)).toBeNull();
    expectTypeOf(repos.posts.get).returns.resolves.toEqualTypeOf<Post | null>();
    expectTypeOf(repos.posts.insert).parameter(0).toEqualTypeOf<{
      title: string;
      body: string;
      status: 'draft' | 'published';
    }>();
  });

  it('update writes the patch and bumps updatedAt; remove returns the doc; both are null for a missing id', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const { repos } = setup();
    const post = await repos.posts.insert(draft, unscoped);

    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));
    const updated = await repos.posts.update(post.id, { title: 'u' }, unscoped);

    expect(updated).toEqual({
      ...post,
      title: 'u',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(
      await repos.posts.update('nope', { title: 'u' }, unscoped),
    ).toBeNull();
    expect(await repos.posts.remove(post.id, unscoped)).toEqual(updated);
    expect(await repos.posts.remove(post.id, unscoped)).toBeNull();
    typeOnly(() => {
      // @ts-expect-error status is draft or published
      repos.posts.update(post.id, { status: 'archived' }, unscoped);
      // @ts-expect-error id is not a field of the data
      repos.posts.update(post.id, { id: 'x' }, unscoped);
    });
  });

  it('getMany returns the docs that exist, in the order of the ids', async () => {
    const { repos } = setup();
    const a = await repos.posts.insert({ ...draft, title: 'a' }, unscoped);
    const b = await repos.posts.insert({ ...draft, title: 'b' }, unscoped);
    expect(await repos.posts.getMany([b.id, 'nope', a.id], unscoped)).toEqual([
      b,
      a,
    ]);
  });

  it('find applies find’s defaults: newest first, 20 per page', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const { repos } = setup();
    for (let day = 1; day <= 25; day += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, day)));
      await repos.posts.insert({ ...draft, title: `p${day}` }, unscoped);
    }

    const first = await repos.posts.find({}, unscoped);
    expect(first.docs.map((doc) => doc.title)).toEqual(
      Array.from({ length: 20 }, (_, i) => `p${25 - i}`),
    );
    const rest = await repos.posts.find({ after: first.next ?? '' }, unscoped);
    expect(rest.docs.map((doc) => doc.title)).toEqual([
      'p5',
      'p4',
      'p3',
      'p2',
      'p1',
    ]);
    expect(rest.next).toBeNull();

    const titled = await repos.posts.find(
      {
        where: { title: { in: ['p1', 'p2'] } },
        sort: ['title'],
        limit: 1,
      },
      unscoped,
    );
    expect(titled.docs.map((doc) => doc.title)).toEqual(['p1']);
    typeOnly(() => {
      // @ts-expect-error colour is not a field
      repos.posts.find({ where: { colour: { eq: 'x' } } }, unscoped);
      // @ts-expect-error status is an enum, so it has no contains
      repos.posts.find({ where: { status: { contains: 'd' } } }, unscoped);
    });
  });

  it('runs no validation, no hooks and no events', async () => {
    const events = new MemoryEventPublisher();
    const { repos } = framework({ family: AppUseCase })
      .collection(
        Posts.hooks({
          beforeChange: ({ data }) => ({ ...data, body: 'hooked' }),
          afterRead: ({ doc }) => ({ ...doc, title: 'read' }),
        }),
        { access: allowAll },
      )
      .build({ store: new MemoryStore(), events });
    const posts = repos.posts;

    // An empty title breaks the schema's min(1); the repo trusts its input.
    const post = await posts.insert({ ...draft, title: '' }, unscoped);
    await posts.update(post.id, { body: 'b2' }, unscoped);
    await posts.remove(post.id, unscoped);

    expect(post).toMatchObject({ title: '', body: 'b' });
    expect(events.messages).toEqual([]);
  });
});

describe('useCases', () => {
  it('holds the instance that serves each procedure, typed precisely', () => {
    let publish: PublishPost | undefined;
    let archive: ArchivePost | undefined;
    const { useCases } = definition.build({
      store: new MemoryStore(),
      events: new MemoryEventPublisher(),
      methods: ({ repos }) => {
        publish = new PublishPost({ posts: repos.posts });
        return { posts: { publish } };
      },
      overrides: ({ repos }) => {
        archive = new ArchivePost({ posts: repos.posts });
        return { posts: { delete: archive } };
      },
    });

    expect(useCases.posts.publish).toBe(publish);
    expect(useCases.posts.delete).toBe(archive);
    expectTypeOf(useCases.posts.publish).toEqualTypeOf<PublishPost>();
    expectTypeOf(useCases.posts.delete).toEqualTypeOf<ArchivePost>();
    expectTypeOf(useCases.posts.get.execute)
      .parameter(1)
      .toEqualTypeOf<{ id: string }>();
    expectTypeOf(
      useCases.posts.get.execute,
    ).returns.resolves.toEqualTypeOf<Post>();
    expectTypeOf(
      useCases.comments.create.execute,
    ).returns.resolves.toEqualTypeOf<z.output<typeof Comments.output>>();
    typeOnly(() => {
      // @ts-expect-error comments has no publish method
      void useCases.comments.publish;
    });
  });

  it('runs a generated use case directly, and resolves to the doc', async () => {
    const { useCases } = setup();
    const post = await useCases.posts.create.execute(callContext(), draft);
    expect(
      await useCases.posts.get.execute(callContext(), { id: post.id }),
    ).toEqual(post);
  });

  it('runs the guards on a direct call: execute does not run', async () => {
    const { useCases, repos } = setup();
    const { logger } = callContext();

    expect(
      await codeOf(
        // @ts-expect-error userId is missing
        useCases.posts.create.execute({ actor: {}, logger }, draft),
      ),
    ).toBe('UNAUTHORIZED');
    expect(
      await codeOf(
        // @ts-expect-error title is a string
        useCases.posts.create.execute(callContext(), { ...draft, title: 1 }),
      ),
    ).toBe('VALIDATION');
    expect((await repos.posts.find({}, unscoped)).docs).toEqual([]);
  });
});

describe('a refusal is logged once on every path', () => {
  /** The refusal lines `root` holds, as code and whether actorId is set. */
  function refusals(root: MemoryLogger) {
    return root.records.map((record) => ({
      level: record.level,
      code: record.fields.code,
      actorId: record.fields.actorId,
    }));
  }

  function client(logger: Logger, checkInput: boolean) {
    return createLocalClient(setup().app, {
      context: { actor, logger },
      validation: { input: checkInput },
    });
  }

  it('a bad actor, through useCases and through the client', async () => {
    const direct = new MemoryLogger();
    const rpc = new MemoryLogger();

    const { useCases } = setup();
    await codeOf(
      // @ts-expect-error userId is missing
      useCases.posts.get.execute({ actor: {}, logger: direct }, { id: 'p1' }),
    );
    await codeOf(
      createLocalClient(setup().app, {
        // @ts-expect-error userId is missing
        context: { actor: {}, logger: rpc },
      }).posts.get({ id: 'p1' }),
    );

    for (const root of [direct, rpc]) {
      expect(refusals(root)).toEqual([
        { level: 'info', code: 'UNAUTHORIZED', actorId: undefined },
      ]);
    }
  });

  it('bad input, through useCases and through the client with ts-pf’s check off', async () => {
    const direct = new MemoryLogger();
    const rpc = new MemoryLogger();

    await codeOf(
      // @ts-expect-error id is a string
      setup().useCases.posts.get.execute({ actor, logger: direct }, { id: 1 }),
    );
    // @ts-expect-error id is a string
    await codeOf(client(rpc, false).posts.get({ id: 1 }));

    for (const root of [direct, rpc]) {
      expect(refusals(root)).toEqual([
        { level: 'info', code: 'VALIDATION', actorId: 'u1' },
      ]);
    }
  });

  it('ts-pf’s own input rejection, from the router middleware', async () => {
    const root = new MemoryLogger();
    // @ts-expect-error id is a string
    await codeOf(client(root, true).posts.get({ id: 1 }));
    expect(refusals(root)).toEqual([
      { level: 'info', code: 'VALIDATION', actorId: 'u1' },
    ]);
  });

  it('a refusal inside execute, through useCases and through the client', async () => {
    const direct = new MemoryLogger();
    const rpc = new MemoryLogger();

    await codeOf(
      setup().useCases.posts.get.execute(
        { ...callContext(direct), actor },
        {
          id: 'nope',
        },
      ),
    );
    await codeOf(client(rpc, true).posts.get({ id: 'nope' }));

    for (const root of [direct, rpc]) {
      expect(refusals(root)).toEqual([
        { level: 'info', code: 'NOT_FOUND', actorId: 'u1' },
      ]);
    }
  });
});

describe('a method and an override', () => {
  it('the method reads and writes through the repo it was built with', async () => {
    const { local, repos, useCases } = setup();
    const post = await local.posts.create(draft);

    const published = await local.posts.publish({ id: post.id });
    expect(published).toMatchObject({ id: post.id, status: 'published' });
    expect(await repos.posts.get(post.id, unscoped)).toEqual(published);

    await repos.posts.update(post.id, { status: 'draft' }, unscoped);
    const again = await useCases.posts.publish.execute(callContext(), {
      id: post.id,
    });
    expect(again.status).toBe('published');
  });

  it('the override replaces the generated delete: the row stays', async () => {
    const { local, repos } = setup();
    const post = await local.posts.create(draft);

    expect(await local.posts.delete({ id: post.id })).toEqual(post);
    expect(await repos.posts.get(post.id, unscoped)).toEqual(post);
    expect((await local.posts.find({})).docs).toEqual([post]);
  });

  it('keep the contract’s types: the override changes no client type, and the method is typed', () => {
    const { local } = setup();
    const { app } = framework({
      family: AppUseCase,
    })
      .collection(Posts, { access: allowAll })
      .collection(Comments, { access: allowAll })
      .build({ store: new MemoryStore(), events: new MemoryEventPublisher() });
    const plain = createLocalClient(app, { context: callContext() });

    expectTypeOf<Omit<typeof local.posts, 'publish'>>().toEqualTypeOf<
      typeof plain.posts
    >();
    expectTypeOf(local.posts.delete).toEqualTypeOf(plain.posts.delete);
    expectTypeOf(local.posts.publish)
      .parameter(0)
      .toEqualTypeOf<{ id: string }>();
    expectTypeOf(local.posts.publish).returns.resolves.toEqualTypeOf<Post>();
  });
});

describe('an event handler', () => {
  /** A handler as a worker runs it: it gets the event and a repo. */
  async function onPostCreated(
    event: EventInstance<typeof AppEvents, 'postsCreated'>,
    posts: Repo<typeof Posts>,
  ): Promise<void> {
    const { doc } = event.payload;
    await posts.update(doc.id, { body: `${doc.body} (indexed)` }, unscoped);
  }

  it('reads the event and writes through repos', async () => {
    const { local, repos, events } = setup();
    const post = await local.posts.create(draft);

    const [message] = events.messages;
    if (message?.key !== 'postsCreated')
      throw new Error('expected postsCreated');
    const event = AppEvents.parse(message);
    if (!(event instanceof Posts.events.created)) {
      throw new Error('expected a posts.created event');
    }
    await onPostCreated(event, repos.posts);

    expect(await repos.posts.get(post.id, unscoped)).toMatchObject({
      body: 'b (indexed)',
    });
  });
});
