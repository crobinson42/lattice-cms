import { createLocalClient } from '@ts-pf/server';
import type { UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArchivePost } from './fixtures/archive-post.js';
import { Comments } from './fixtures/comments.js';
import { AppUseCase, allowAll, callContext } from './fixtures/context.js';
import { MemoryEventPublisher } from './fixtures/events.js';
import { Posts } from './fixtures/posts.js';
import { PublishPost } from './fixtures/publish-post.js';
import {
  collection,
  family,
  framework,
  MemoryStore,
  type Sort,
  type Where,
} from './index.js';

type Post = {
  title: string;
  body: string;
  status: 'draft' | 'published';
  id: string;
  createdAt: string;
  updatedAt: string;
};

type Ctx = UseCase.Ctx<typeof AppUseCase>;

const lattice = framework({
  family: AppUseCase,
})
  .collection(Posts, {
    access: { ...allowAll, publish: () => true },
    methods: { publish: PublishPost },
    overrides: { delete: ArchivePost },
  })
  .collection(Comments, { access: allowAll });

const { app } = lattice.build({
  store: new MemoryStore(),
  events: new MemoryEventPublisher(),
  methods: ({ repos }) => ({
    posts: { publish: new PublishPost({ posts: repos.posts }) },
  }),
  overrides: ({ repos }) => ({
    posts: { delete: new ArchivePost({ posts: repos.posts }) },
  }),
});

const local = createLocalClient(app, {
  context: callContext(),
});

/** A store and a publisher for one build. */
function ports() {
  return { store: new MemoryStore(), events: new MemoryEventPublisher() };
}

/** Statements the compiler checks and the test never runs. */
function typeOnly(_statements: () => unknown): void {}

describe('type flow', () => {
  it('get returns the schema plus system fields', () => {
    typeOnly(async () => {
      const post = await local.posts.get({ id: 'p1' });
      expectTypeOf(post).toEqualTypeOf<Post>();
    });
  });

  it('create excludes system fields; update is a partial patch plus id', () => {
    expectTypeOf(local.posts.create).parameter(0).toEqualTypeOf<{
      title: string;
      body: string;
      status: 'draft' | 'published';
    }>();
    expectTypeOf(local.posts.update).parameter(0).toEqualTypeOf<{
      title?: string | undefined;
      body?: string | undefined;
      status?: 'draft' | 'published' | undefined;
      id: string;
    }>();
    typeOnly(() => {
      local.posts.create({
        title: 't',
        body: 'b',
        status: 'draft',
        // @ts-expect-error system fields are not input
        id: 'p1',
      });
      // @ts-expect-error update needs id
      local.posts.update({ title: 't' });
    });
  });

  it('find takes where, sort, limit and after and returns a page', () => {
    expectTypeOf(local.posts.find).parameter(0).toEqualTypeOf<{
      where?: Where<Post> | undefined;
      sort?: Sort<Post> | undefined;
      limit?: number | undefined;
      after?: string | undefined;
    }>();
    expectTypeOf(local.posts.find).returns.resolves.toEqualTypeOf<{
      docs: Post[];
      next: string | null;
    }>();
  });

  it('a custom method is typed from its use case', () => {
    expectTypeOf(local.posts.publish)
      .parameter(0)
      .toEqualTypeOf<{ id: string }>();
    expectTypeOf(local.posts.publish).returns.resolves.toEqualTypeOf<Post>();
  });

  it('an override keeps the generated types; delete returns the document', () => {
    expectTypeOf(local.posts.delete)
      .parameter(0)
      .toEqualTypeOf<{ id: string }>();
    expectTypeOf(local.posts.delete).returns.resolves.toEqualTypeOf<Post>();
  });

  it('a second collection gets its own slice', () => {
    expectTypeOf(local.comments.get).returns.resolves.toEqualTypeOf<{
      postId: string;
      text: string;
      id: string;
      createdAt: string;
      updatedAt: string;
    }>();
    // @ts-expect-error methods belong to their own collection
    expectTypeOf(local.comments.publish).toBeFunction();
  });
});

describe('method checks', () => {
  const publishInput = z.object({ id: z.string() });

  class InputMismatch extends AppUseCase('posts.publish', {
    collection: Posts,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: number },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class OutputMismatch extends AppUseCase('posts.publish', {
    collection: Posts,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(_ctx: Ctx, input: { id: string }): Promise<{ id: string }> {
      return input;
    }
  }

  class OtherCollection extends AppUseCase('posts.publish', {
    collection: Comments,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class Misspelled extends AppUseCase('posts.publsh', {
    collection: Posts,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class UseMethod extends AppUseCase('posts.use', {
    collection: Posts,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  const OtherUseCase = family({
    actor: z.object({ tenant: z.string() }),
    actorId: (other) => other.tenant,
  });
  class OtherFamily extends OtherUseCase('posts.publish', {
    collection: Posts,
    input: publishInput,
    output: Posts.output,
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof OtherUseCase>,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  it('rejects a method that does not match its schemas or where it is attached', () => {
    const app = framework({
      family: AppUseCase,
    });
    typeOnly(() => {
      app.collection(Posts, {
        access: { ...allowAll, publish: () => true },
        // @ts-expect-error execute takes { id: number }; the input schema says string
        methods: { publish: InputMismatch },
      });
      app.collection(Posts, {
        access: { ...allowAll, publish: () => true },
        // @ts-expect-error execute returns { id }; the output schema says a post
        methods: { publish: OutputMismatch },
      });
      app.collection(Posts, {
        access: { ...allowAll, publish: () => true },
        // @ts-expect-error its collection static is Comments
        methods: { publish: OtherCollection },
      });
      app.collection(Posts, {
        access: { ...allowAll, publish: () => true },
        // @ts-expect-error its token is posts.publsh
        methods: { publish: Misspelled },
      });
      app.collection(Posts, {
        access: { ...allowAll, publish: () => true },
        // @ts-expect-error a use case from another family
        methods: { publish: OtherFamily },
      });
    });
  });

  it('rejects a reserved or generated name, at compile time and at runtime', () => {
    expect(() =>
      framework({
        family: AppUseCase,
      }).collection(Posts, {
        access: { ...allowAll, use: () => true },
        // @ts-expect-error use is a ts-pf implementer key
        methods: { use: UseMethod },
      }),
    ).toThrow('"posts.use" cannot be a method name');
    expect(() =>
      framework({
        family: AppUseCase,
      }).collection(Posts, {
        access: { ...allowAll, get: () => true },
        // @ts-expect-error get is a generated operation
        methods: { get: PublishPost },
      }),
    ).toThrow('"posts.get" cannot be a method name');
  });
});

describe('override checks', () => {
  class WrongInput extends AppUseCase('posts.delete', { collection: Posts }) {
    async execute(
      _ctx: Ctx,
      _input: { id: number },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class NarrowerInput extends AppUseCase('posts.delete', {
    collection: Posts,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string; reason: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class WrongOutput extends AppUseCase('posts.delete', { collection: Posts }) {
    async execute(_ctx: Ctx, input: { id: string }): Promise<{ id: string }> {
      return input;
    }
  }

  class OtherCollection extends AppUseCase('posts.delete', {
    collection: Comments,
  }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  it('rejects an override that takes or returns the wrong types', () => {
    const app = framework({
      family: AppUseCase,
    });
    typeOnly(() => {
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error input id is a number
        overrides: { delete: WrongInput },
      });
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error input needs a field the operation does not send
        overrides: { delete: NarrowerInput },
      });
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error delete returns the document, not { id }
        overrides: { delete: WrongOutput },
      });
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error its collection static is Comments
        overrides: { delete: OtherCollection },
      });
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error its token is posts.delete, not posts.get
        overrides: { get: ArchivePost },
      });
      app.collection(Posts, {
        access: allowAll,
        // @ts-expect-error publish is not a generated operation
        overrides: { publish: ArchivePost },
      });
    });
  });

  it('accepts an override that matches', () => {
    const app = framework({
      family: AppUseCase,
    }).collection(Posts, {
      access: allowAll,
      overrides: { delete: ArchivePost },
    });
    app.build({
      ...ports(),
      overrides: ({ repos }) => ({
        posts: { delete: new ArchivePost({ posts: repos.posts }) },
      }),
    });
    expect(Object.keys(app.contract.posts)).toEqual([
      'find',
      'count',
      'get',
      'create',
      'update',
      'delete',
    ]);
  });
});

describe('collection checks', () => {
  it('rejects a slug added twice, at compile time and at runtime', () => {
    const app = framework({
      family: AppUseCase,
    }).collection(Posts, { access: allowAll });
    // @ts-expect-error posts is already a collection
    expect(() => app.collection(Posts, { access: allowAll })).toThrow(
      '"posts" is already a collection',
    );
  });

  it('rejects a ts-pf implementer key as a slug, at compile time and at runtime', () => {
    const Routers = collection('router', {
      schema: z.object({ name: z.string() }),
    });
    const app = framework({
      family: AppUseCase,
    });
    // @ts-expect-error router is a ts-pf implementer key
    expect(() => app.collection(Routers, { access: allowAll })).toThrow(
      '"router" is a ts-pf implementer key',
    );
  });
});

describe('build checks', () => {
  const withBoth = framework({
    family: AppUseCase,
  }).collection(Posts, {
    access: { ...allowAll, publish: () => true },
    methods: { publish: PublishPost },
    overrides: { delete: ArchivePost },
  });

  it('is a type error when an instance is missing or of the wrong class', () => {
    typeOnly(() => {
      // @ts-expect-error methods and overrides are required
      withBoth.build(ports());
      withBoth.build({
        ...ports(),
        // @ts-expect-error posts has no methods
        methods: () => ({}),
        overrides: ({ repos }) => ({
          posts: { delete: new ArchivePost({ posts: repos.posts }) },
        }),
      });
      withBoth.build({
        ...ports(),
        methods: ({ repos }) => ({
          posts: { publish: new PublishPost({ posts: repos.posts }) },
        }),
        // @ts-expect-error posts.delete has no instance
        overrides: () => ({ posts: {} }),
      });
      withBoth.build({
        ...ports(),
        methods: ({ repos }) => ({
          // @ts-expect-error an ArchivePost is not a PublishPost: their private deps differ
          posts: { publish: new ArchivePost({ posts: repos.posts }) },
        }),
        overrides: ({ repos }) => ({
          posts: { delete: new ArchivePost({ posts: repos.posts }) },
        }),
      });
    });
  });

  it('throws when a declared method has no instance', () => {
    expect(() =>
      withBoth.build({
        ...ports(),
        // @ts-expect-error posts.publish has no instance
        methods: () => ({ posts: {} }),
        overrides: ({ repos }) => ({
          posts: { delete: new ArchivePost({ posts: repos.posts }) },
        }),
      }),
    ).toThrow('no instance for method "posts.publish"');
  });

  it('throws when a declared override has no instance', () => {
    expect(() =>
      withBoth.build({
        ...ports(),
        methods: ({ repos }) => ({
          posts: { publish: new PublishPost({ posts: repos.posts }) },
        }),
        // @ts-expect-error posts.delete has no instance
        overrides: () => ({ posts: {} }),
      }),
    ).toThrow('no instance for override "posts.delete"');
  });

  it('throws on an override key that is not a generated operation', () => {
    // .collection() throws, before build(): method names are checked there too.
    expect(() =>
      framework({
        family: AppUseCase,
      }).collection(Posts, {
        access: allowAll,
        // @ts-expect-error publish is not a generated operation
        overrides: { publish: ArchivePost },
      }),
    ).toThrow('"posts.publish" is not a generated operation');
  });

  class SoftDelete extends AppUseCase('posts.delete', { collection: Posts }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  class HideDelete extends AppUseCase('posts.delete', { collection: Posts }) {
    async execute(
      _ctx: Ctx,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('todo');
    }
  }

  it('throws when an instance is of another class with the same members', () => {
    // SoftDelete and HideDelete have no private members, so the type check
    // accepts one for the other. The runtime check does not.
    expect(() =>
      framework({
        family: AppUseCase,
      })
        .collection(Posts, {
          access: allowAll,
          overrides: { delete: SoftDelete },
        })
        .build({
          store: new MemoryStore(),
          events: new MemoryEventPublisher(),
          overrides: () => ({ posts: { delete: new HideDelete() } }),
        }),
    ).toThrow('"posts.delete" instance is not an instance of SoftDelete');
  });

  it('throws when a method instance is of another class', () => {
    expect(() =>
      withBoth.build({
        ...ports(),
        methods: ({ repos }) => ({
          // @ts-expect-error an ArchivePost is not a PublishPost
          posts: { publish: new ArchivePost({ posts: repos.posts }) },
        }),
        overrides: ({ repos }) => ({
          posts: { delete: new ArchivePost({ posts: repos.posts }) },
        }),
      }),
    ).toThrow('"posts.publish" instance is not an instance of PublishPost');
  });

  it('needs no options when nothing is attached', () => {
    const app = framework({ family: AppUseCase }).collection(Comments, {
      access: allowAll,
    });
    expect(() => app.build(ports())).not.toThrow();
    expect(Object.keys(app.contract.comments)).toEqual([
      'find',
      'count',
      'get',
      'create',
      'update',
      'delete',
    ]);
  });
});

describe('load time', () => {
  it('imports the fixtures and builds without throwing', () => {
    lattice.build({
      ...ports(),
      methods: ({ repos }) => ({
        posts: { publish: new PublishPost({ posts: repos.posts }) },
      }),
      overrides: ({ repos }) => ({
        posts: { delete: new ArchivePost({ posts: repos.posts }) },
      }),
    });
    expect(Object.keys(lattice.contract.posts)).toEqual([
      'find',
      'count',
      'get',
      'create',
      'update',
      'delete',
      'publish',
    ]);
    expect(Object.keys(lattice.contract.comments)).toHaveLength(6);
  });
});
