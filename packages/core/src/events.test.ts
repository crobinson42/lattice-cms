import { type Logger, MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { Adapter, EventCatalog, type EventInstance, type UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { z } from 'zod';
import { LatticeError } from './errors.js';
import { ArchivePost } from './fixtures/archive-post.js';
import { Comments } from './fixtures/comments.js';
import { AppUseCase, callContext } from './fixtures/context.js';
import {
  AppEvents,
  DomainEventPublisher,
  MemoryEventPublisher,
  PostPublishedEvent,
} from './fixtures/events.js';
import { Posts } from './fixtures/posts.js';
import { type CollectionStore, framework, MemoryStore } from './index.js';
import type { Doc, Patch } from './store.js';

type Post = z.output<typeof Posts.output>;

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

/** A store that records each write it completes in `log`. */
class RecordingStore extends MemoryStore {
  constructor(private readonly log: string[]) {
    super();
  }

  override async insert(collection: string, doc: Doc): Promise<void> {
    await super.insert(collection, doc);
    this.log.push(`insert ${collection}`);
  }

  override async update(
    collection: string,
    id: string,
    patch: Patch,
  ): Promise<Doc | null> {
    const doc = await super.update(collection, id, patch);
    this.log.push(`update ${collection}`);
    return doc;
  }

  override async remove(collection: string, id: string): Promise<Doc | null> {
    const doc = await super.remove(collection, id);
    this.log.push(`remove ${collection}`);
    return doc;
  }
}

/** A publisher that records each event in `log` before it publishes it. */
class RecordingPublisher extends MemoryEventPublisher {
  constructor(private readonly log: string[]) {
    super();
  }

  override async publish(
    event: EventInstance<typeof AppEvents>,
  ): Promise<void> {
    this.log.push(`publish ${event.token}`);
    await super.publish(event);
  }
}

class DownPublisher extends Adapter(DomainEventPublisher) {
  override async publish(): Promise<void> {
    throw new Error('queue down');
  }
}

/** A store whose every insert finds the id taken. */
class TakenStore extends MemoryStore {
  override async insert(collection: string, doc: Doc): Promise<void> {
    throw LatticeError.CONFLICT({ collection, id: doc.id });
  }
}

function setup(
  store: CollectionStore = new MemoryStore(),
  events: DomainEventPublisher = new MemoryEventPublisher(),
  logger?: Logger,
) {
  const { app } = framework({ family: AppUseCase, store, events })
    .collection(Posts)
    .collection(Comments)
    .build();
  // Without ts-pf's own input check, bad input reaches Lattice's guard.
  return createLocalClient(app, {
    context: callContext(logger),
    validation: { input: false },
  });
}

/** The code a call fails with, or 'ok'. A client receives a PFError; `execute` throws the LatticeError. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

describe('collection events', () => {
  it('are hexok Event classes with the collection tokens', () => {
    expect(Posts.events.created.token).toBe('posts.created');
    expect(Posts.events.updated.token).toBe('posts.updated');
    expect(Posts.events.deleted.token).toBe('posts.deleted');
    expect(Comments.events.created.token).toBe('comments.created');
    expectTypeOf(Posts.events.created.token).toEqualTypeOf<'posts.created'>();
  });

  it('type their payloads from the schema', () => {
    expectTypeOf<
      InstanceType<typeof Posts.events.created>['payload']
    >().toEqualTypeOf<{ doc: Post; actorId: string }>();
    expectTypeOf<
      InstanceType<typeof Posts.events.updated>['payload']
    >().toEqualTypeOf<{ doc: Post; previous: Post; actorId: string }>();
    expectTypeOf<
      InstanceType<typeof Posts.events.deleted>['payload']
    >().toEqualTypeOf<{ doc: Post; actorId: string }>();
    expectTypeOf<
      EventInstance<typeof AppEvents, 'postsUpdated'>['payload']['previous']
    >().toEqualTypeOf<Post>();
  });

  it('are the same classes after hooks(), so the catalog still knows them', () => {
    const Hooked = Posts.hooks({ afterRead: ({ doc }) => doc });
    expect(Hooked.events).toBe(Posts.events);
  });

  it('join the app catalog next to a hand-written event', () => {
    const now = new Date().toISOString();
    const doc = {
      id: 'p1',
      title: 't',
      body: 'b',
      status: 'draft' as const,
      createdAt: now,
      updatedAt: now,
    };
    expect(
      AppEvents.message(new Posts.events.created({ doc, actorId: 'u1' })),
    ).toEqual({ key: 'postsCreated', payload: { doc, actorId: 'u1' } });
    expect(
      AppEvents.message(
        new PostPublishedEvent({ postId: 'p1', actorId: 'u1' }),
      ),
    ).toEqual({
      key: 'postPublished',
      payload: { postId: 'p1', actorId: 'u1' },
    });
  });
});

describe('the events publisher', () => {
  class OtherEvents extends EventCatalog('other', {
    postPublished: PostPublishedEvent,
    postsCreated: Posts.events.created,
  }) {}

  /** A publisher whose catalog has posts.created only. */
  class OtherPublisher {
    readonly sent: unknown[] = [];

    async publish(event: EventInstance<typeof OtherEvents>): Promise<void> {
      this.sent.push(OtherEvents.message(event));
    }
  }

  it('is required', () => {
    typeOnly(() => {
      // @ts-expect-error events is required
      framework({ family: AppUseCase, store: new MemoryStore() });
      framework({
        family: AppUseCase,
        store: new MemoryStore(),
        // @ts-expect-error events has no publish
        events: {},
      });
    });
  });

  it('fits when it is typed by a catalog that lists the collection events', () => {
    const app = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: new MemoryEventPublisher(),
    });
    expect(() => app.collection(Posts).collection(Comments)).not.toThrow();
  });

  it('is a type error on .collection() when the publisher cannot take its events', () => {
    const app = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: new OtherPublisher(),
    });
    typeOnly(() => {
      // @ts-expect-error the publisher takes posts.created, not posts.updated or posts.deleted
      app.collection(Posts);
      // @ts-expect-error the publisher takes no comments events
      app.collection(Comments);
    });
  });

  it('throws at runtime for an event its catalog lacks, as app-template’s adapter does', async () => {
    const store = new MemoryStore();
    const events = new OtherPublisher();
    const { app } = framework({ family: AppUseCase, store, events })
      // @ts-expect-error the publisher takes posts.created only
      .collection(Posts)
      .build();
    const local = createLocalClient(app, { context: callContext() });

    const post = await local.posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });
    expect(events.sent).toHaveLength(1);
    await expect(
      local.posts.update({ id: post.id, title: 'u' }),
    ).rejects.toThrow('hexok: event "posts.updated" is not in catalog "other"');
  });
});

describe('generated writes', () => {
  it('publish one event per write, with the stored document and the actor id', async () => {
    const events = new MemoryEventPublisher();
    const local = setup(new MemoryStore(), events);

    const created = await local.posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });
    const updated = await local.posts.update({
      id: created.id,
      status: 'published',
    });
    const deleted = await local.posts.delete({ id: created.id });

    expect(events.messages).toEqual([
      { key: 'postsCreated', payload: { doc: created, actorId: 'u1' } },
      {
        key: 'postsUpdated',
        payload: { doc: updated, previous: created, actorId: 'u1' },
      },
      { key: 'postsDeleted', payload: { doc: deleted, actorId: 'u1' } },
    ]);
  });

  it('take actorId from the family', async () => {
    const events = new MemoryEventPublisher();
    const { app } = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events,
    })
      .collection(Comments)
      .build();
    const local = createLocalClient(app, {
      context: { ...callContext(), actor: { userId: 'u2', roles: [] } },
    });

    await local.comments.create({ postId: 'p1', text: 'hi' });

    expect(events.messages).toMatchObject([
      { key: 'commentsCreated', payload: { actorId: 'u2' } },
    ]);
  });

  it('carry the stored document, not the afterRead result', async () => {
    const events = new MemoryEventPublisher();
    const { app } = framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events,
    })
      .collection(
        Posts.hooks({
          afterRead: ({ doc }) => ({ ...doc, title: doc.title.toUpperCase() }),
        }),
      )
      .build();
    const local = createLocalClient(app, { context: callContext() });

    const created = await local.posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });
    await local.posts.update({ id: created.id, body: 'c' });
    await local.posts.delete({ id: created.id });

    expect(created.title).toBe('T');
    expect(events.messages).toMatchObject([
      { payload: { doc: { title: 't' } } },
      { payload: { doc: { title: 't' }, previous: { title: 't' } } },
      { payload: { doc: { title: 't' } } },
    ]);
  });

  it('publish after the store write, never before', async () => {
    const log: string[] = [];
    const local = setup(new RecordingStore(log), new RecordingPublisher(log));

    const post = await local.posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });
    await local.posts.update({ id: post.id, title: 'u' });
    await local.posts.delete({ id: post.id });

    expect(log).toEqual([
      'insert posts',
      'publish posts.created',
      'update posts',
      'publish posts.updated',
      'remove posts',
      'publish posts.deleted',
    ]);
  });

  it('publish nothing when the write fails', async () => {
    const events = new MemoryEventPublisher();
    const local = setup(new MemoryStore(), events);
    const taken = setup(new TakenStore(), events);

    expect(await codeOf(local.posts.update({ id: 'nope', title: 'u' }))).toBe(
      'NOT_FOUND',
    );
    expect(await codeOf(local.posts.delete({ id: 'nope' }))).toBe('NOT_FOUND');
    expect(
      await codeOf(
        local.posts.create({ title: '', body: 'b', status: 'draft' }),
      ),
    ).toBe('VALIDATION');
    expect(
      await codeOf(
        taken.posts.create({ title: 't', body: 'b', status: 'draft' }),
      ),
    ).toBe('CONFLICT');

    expect(events.messages).toEqual([]);
  });

  it('publish nothing on get and find', async () => {
    const store = new MemoryStore();
    const writes = new MemoryEventPublisher();
    const post = await setup(store, writes).posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });

    const reads = new MemoryEventPublisher();
    const local = setup(store, reads);
    await local.posts.get({ id: post.id });
    await local.posts.find({});

    expect(reads.messages).toEqual([]);
  });

  it('pass a publish failure to the caller after the write, and log it once as a failure', async () => {
    const store = new MemoryStore();
    const root = new MemoryLogger();
    const local = setup(store, new DownPublisher(), root);

    await expect(
      local.posts.create({ title: 't', body: 'b', status: 'draft' }),
    ).rejects.toThrow('queue down');

    const { docs } = await store.find({
      collection: 'posts',
      sort: [],
      limit: 10,
    });
    expect(docs).toMatchObject([{ title: 't' }]);
    expect(root.records).toHaveLength(1);
    expect(root.records[0]).toMatchObject({
      level: 'error',
      message: 'queue down',
      fields: { action: 'create', outcome: 'failed' },
    });
  });
});

describe('an override', () => {
  /** An override that publishes the event it chooses itself. */
  class AnnouncedArchive extends AppUseCase('posts.delete', {
    collection: Posts,
  }) {
    constructor(
      private readonly deps: {
        store: CollectionStore;
        events: DomainEventPublisher;
      },
    ) {
      super();
    }

    async execute(
      ctx: UseCase.Ctx<typeof AppUseCase>,
      input: { id: string },
    ): Promise<Post> {
      const stored = await this.deps.store.get(Posts.slug, input.id);
      if (stored === null) {
        throw LatticeError.NOT_FOUND({ collection: Posts.slug, id: input.id });
      }
      const doc = Posts.output.parse(stored);
      await this.deps.events.publish(
        new Posts.events.deleted({
          doc,
          actorId: AppUseCase.actorId(ctx.actor),
        }),
      );
      return doc;
    }
  }

  /** A store with one post, and a publisher that has seen nothing yet. */
  async function seeded() {
    const store = new MemoryStore();
    const post = await setup(store).posts.create({
      title: 't',
      body: 'b',
      status: 'draft',
    });
    return { store, events: new MemoryEventPublisher(), post };
  }

  it('publishes no posts.deleted for ArchivePost, which publishes nothing itself', async () => {
    const { store, events, post } = await seeded();
    const lattice = framework({ family: AppUseCase, store, events }).collection(
      Posts,
      { overrides: { delete: ArchivePost } },
    );
    const { app } = lattice.build({
      overrides: {
        posts: { delete: new ArchivePost({ posts: lattice.repo(Posts) }) },
      },
    });
    const local = createLocalClient(app, { context: callContext() });

    await local.posts.delete({ id: post.id });

    expect(events.messages).toEqual([]);
    expect(await store.get('posts', post.id)).not.toBeNull();
  });

  it('publishes only the events the override publishes itself', async () => {
    const { store, events, post } = await seeded();
    const { app } = framework({ family: AppUseCase, store, events })
      .collection(Posts, { overrides: { delete: AnnouncedArchive } })
      .build({
        overrides: {
          posts: { delete: new AnnouncedArchive({ store, events }) },
        },
      });
    const local = createLocalClient(app, { context: callContext() });

    await local.posts.delete({ id: post.id });

    expect(events.messages).toMatchObject([
      { key: 'postsDeleted', payload: { doc: { id: post.id }, actorId: 'u1' } },
    ]);
  });
});
