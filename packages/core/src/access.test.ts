import { MemoryLogger } from '@hexok/logger';
import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import { Adapter, type UseCase } from 'hexok';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LatticeError } from './errors.js';
import { AppUseCase, actor, callContext } from './fixtures/context.js';
import { Posts } from './fixtures/posts.js';
import {
  Access,
  type AccessRequest,
  collection,
  type Doc,
  framework,
  MemoryStore,
  type Repo,
  unscoped,
} from './index.js';
import type { AnyWhere } from './where.js';

const Notes = collection('notes', {
  schema: z.object({
    ownerId: z.string(),
    title: z.string(),
    rank: z.number(),
    pinned: z.boolean().default(false),
  }),
});

type Actor = { userId: string; roles: string[] };

/** The code a call fails with, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error) =>
      isPFError(error) || LatticeError.is(error) ? error.code : error,
  );
}

/** A publisher for every catalog: these tests are not about events. */
const noEvents = { publish: async (_event: object) => {} };

/** A store that records the filter of every single-row call. */
class SpyStore extends MemoryStore {
  readonly filters: { call: string; where: AnyWhere | undefined }[] = [];

  override get(collection: string, id: string, where?: AnyWhere) {
    this.filters.push({ call: 'get', where });
    return super.get(collection, id, where);
  }

  override update(
    collection: string,
    id: string,
    patch: Parameters<MemoryStore['update']>[2],
    where?: AnyWhere,
  ) {
    this.filters.push({ call: 'update', where });
    return super.update(collection, id, patch, where);
  }

  override remove(collection: string, id: string, where?: AnyWhere) {
    this.filters.push({ call: 'remove', where });
    return super.remove(collection, id, where);
  }
}

/** Renames a note the caller may rename. */
class RenameNote extends AppUseCase('notes.rename', {
  collection: Notes,
  input: z.object({ id: z.string(), title: z.string() }),
  output: Notes.output,
}) {
  constructor(private readonly deps: { notes: Repo<typeof Notes> }) {
    super();
  }

  async execute(
    ctx: UseCase.Ctx<typeof AppUseCase>,
    input: { id: string; title: string },
  ): Promise<Doc<typeof Notes>> {
    const scope = await ctx.access.scope(Notes, 'rename');
    const note = await this.deps.notes.update(
      input.id,
      { title: input.title },
      scope,
    );
    if (note === null) {
      throw LatticeError.NOT_FOUND({ collection: Notes.slug, id: input.id });
    }
    return note;
  }
}

/** Counts the posts the caller may read: another collection's read scope. */
class CountPosts extends AppUseCase('notes.countPosts', {
  collection: Notes,
  input: z.object({}),
  output: z.object({ count: z.number() }),
}) {
  constructor(private readonly deps: { posts: Repo<typeof Posts> }) {
    super();
  }

  async execute(ctx: UseCase.Ctx<typeof AppUseCase>) {
    const scope = await ctx.access.scope(Posts, 'find');
    const { docs } = await this.deps.posts.find({ limit: 100 }, scope);
    return { count: docs.length };
  }
}

/** How often each access function ran. */
function counter() {
  const calls: Record<string, number> = {};
  const count = (name: string) => {
    calls[name] = (calls[name] ?? 0) + 1;
  };
  return { calls, count };
}

const mine = ({ actor }: { actor: Actor }) => ({
  ownerId: { eq: actor.userId },
});

function setup(store = new MemoryStore()) {
  const { calls, count } = counter();
  const created: unknown[] = [];
  const lattice = framework({ family: AppUseCase })
    .collection(Notes, {
      access: {
        read: ({ actor }) => {
          count('read');
          return mine({ actor });
        },
        create: ({ data }) => {
          count('create');
          created.push(data);
          return data.title !== 'refused';
        },
        update: ({ actor }) => {
          count('update');
          return mine({ actor });
        },
        delete: ({ actor }) => {
          count('delete');
          return mine({ actor });
        },
        rename: ({ actor }) => {
          count('rename');
          return mine({ actor });
        },
        countPosts: () => {
          count('countPosts');
          return true;
        },
      },
      methods: { rename: RenameNote, countPosts: CountPosts },
    })
    .collection(Posts, {
      access: { read: () => ({ status: { eq: 'published' } }) },
    });
  const built = lattice.build({
    store,
    events: noEvents,
    methods: ({ repos }) => ({
      notes: {
        rename: new RenameNote({ notes: repos.notes }),
        countPosts: new CountPosts({ posts: repos.posts }),
      },
    }),
  });
  const local = createLocalClient(built.app, { context: callContext() });
  return { ...built, local, calls, created };
}

/** Notes of `ownerId`, inserted directly. */
async function notesOf(
  repos: { readonly notes: Repo<typeof Notes> },
  ownerId: string,
  ranks: number[],
) {
  const notes = [];
  for (const rank of ranks) {
    notes.push(
      await repos.notes.insert(
        { ownerId, title: `${ownerId}-${rank}`, rank, pinned: false },
        unscoped,
      ),
    );
  }
  return notes;
}

describe('access: false', () => {
  function denied() {
    const { app } = framework({ family: AppUseCase })
      .collection(Notes, {
        access: { rename: () => false },
        methods: { rename: RenameNote },
      })
      .build({
        store: new MemoryStore(),
        events: noEvents,
        methods: ({ repos }) => ({
          notes: { rename: new RenameNote({ notes: repos.notes }) },
        }),
      });
    return createLocalClient(app, { context: callContext() });
  }

  it('is FORBIDDEN on find, get, create, update, delete and a method', async () => {
    const local = denied();
    const note = { ownerId: 'u1', title: 't', rank: 1 };
    expect(await codeOf(local.notes.find({}))).toBe('FORBIDDEN');
    expect(await codeOf(local.notes.get({ id: 'n1' }))).toBe('FORBIDDEN');
    expect(await codeOf(local.notes.create(note))).toBe('FORBIDDEN');
    expect(await codeOf(local.notes.update({ id: 'n1', rank: 2 }))).toBe(
      'FORBIDDEN',
    );
    expect(await codeOf(local.notes.delete({ id: 'n1' }))).toBe('FORBIDDEN');
    expect(await codeOf(local.notes.rename({ id: 'n1', title: 'x' }))).toBe(
      'FORBIDDEN',
    );
  });

  it('refuses a method that never asks for its own scope', async () => {
    const { app } = framework({ family: AppUseCase })
      .collection(Notes, {
        access: { countPosts: () => false },
        methods: { countPosts: CountPosts },
      })
      .collection(Posts, { access: { read: () => true } })
      .build({
        store: new MemoryStore(),
        events: noEvents,
        methods: ({ repos }) => ({
          notes: { countPosts: new CountPosts({ posts: repos.posts }) },
        }),
      });
    const local = createLocalClient(app, { context: callContext() });

    expect(await codeOf(local.notes.countPosts({}))).toBe('FORBIDDEN');
  });

  it('is logged once, at info, by the family', async () => {
    const { app } = framework({ family: AppUseCase })
      .collection(Notes, { access: {} })
      .build({ store: new MemoryStore(), events: noEvents });
    const logger = new MemoryLogger();
    const local = createLocalClient(app, { context: callContext(logger) });

    await codeOf(local.notes.get({ id: 'n1' }));

    expect(logger.records).toMatchObject([
      {
        level: 'info',
        message: 'notes.get',
        fields: {
          collection: 'notes',
          action: 'get',
          actorId: 'u1',
          outcome: 'refused',
          code: 'FORBIDDEN',
        },
      },
    ]);
  });

  it('is FORBIDDEN for an action with no function', async () => {
    const { context } = setup();
    await expect(
      context(callContext()).access.scope(Notes, 'archive'),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('access: a Where', () => {
  it('narrows find, across pages with ties', async () => {
    const { local, repos } = setup();
    const own = await notesOf(repos, 'u1', [1, 1, 1, 2, 2]);
    await notesOf(repos, 'u2', [1, 1, 2, 2]);

    const seen: string[] = [];
    let after: string | undefined;
    do {
      const page = await local.notes.find({
        sort: ['rank'],
        limit: 2,
        ...(after === undefined ? {} : { after }),
      });
      seen.push(...page.docs.map((doc) => doc.id));
      after = page.next ?? undefined;
    } while (after !== undefined);

    expect(seen.sort()).toEqual(own.map((note) => note.id).sort());
  });

  it('ANDs with the caller’s where, which cannot widen it', async () => {
    const { local, repos } = setup();
    await notesOf(repos, 'u1', [1, 2]);
    await notesOf(repos, 'u2', [1, 2]);

    const page = await local.notes.find({
      where: { or: [{ ownerId: { eq: 'u2' } }, { rank: { eq: 1 } }] },
    });

    expect(page.docs.map((doc) => [doc.ownerId, doc.rank])).toEqual([
      ['u1', 1],
    ]);
  });

  it('makes a row outside it NOT_FOUND on get, update and delete, never loaded unfiltered', async () => {
    const store = new SpyStore();
    const { local, repos } = setup(store);
    const [theirs] = await notesOf(repos, 'u2', [1]);
    const id = theirs?.id ?? '';
    store.filters.length = 0;

    expect(await codeOf(local.notes.get({ id }))).toBe('NOT_FOUND');
    expect(await codeOf(local.notes.update({ id, rank: 9 }))).toBe('NOT_FOUND');
    expect(await codeOf(local.notes.delete({ id }))).toBe('NOT_FOUND');

    const filter = { ownerId: { eq: 'u1' } };
    expect(store.filters).toEqual([
      { call: 'get', where: filter },
      { call: 'get', where: filter },
      { call: 'remove', where: filter },
    ]);
    expect(await repos.notes.get(id, unscoped)).toMatchObject({ rank: 1 });
  });
});

describe('access per action', () => {
  it('update uses only update’s function', async () => {
    const { app, repos } = framework({ family: AppUseCase })
      .collection(Notes, {
        access: { read: () => false, update: () => true },
      })
      .build({ store: new MemoryStore(), events: noEvents });
    const local = createLocalClient(app, { context: callContext() });
    const [note] = await notesOf(repos, 'u2', [1]);

    const updated = await local.notes.update({ id: note?.id ?? '', rank: 5 });

    expect(updated).toMatchObject({ rank: 5 });
  });

  it('create receives the parsed input as data', async () => {
    const { local, created } = setup();

    await local.notes.create({ ownerId: 'u1', title: 't', rank: 1 });
    const refused = local.notes.create({
      ownerId: 'u1',
      title: 'refused',
      rank: 1,
    });

    expect(await codeOf(refused)).toBe('FORBIDDEN');
    expect(created[0]).toEqual({
      ownerId: 'u1',
      title: 't',
      rank: 1,
      pinned: false,
    });
  });
});

describe('a method', () => {
  it('gets its own scope', async () => {
    const { local, repos } = setup();
    const [own] = await notesOf(repos, 'u1', [1]);
    const [theirs] = await notesOf(repos, 'u2', [1]);

    const renamed = await local.notes.rename({ id: own?.id ?? '', title: 'r' });

    expect(renamed).toMatchObject({ title: 'r' });
    expect(
      await codeOf(local.notes.rename({ id: theirs?.id ?? '', title: 'r' })),
    ).toBe('NOT_FOUND');
  });

  it('gets another collection’s read scope', async () => {
    const { local, repos } = setup();
    const post = { title: 't', body: 'b' };
    await repos.posts.insert({ ...post, status: 'published' }, unscoped);
    await repos.posts.insert({ ...post, status: 'draft' }, unscoped);

    expect(await local.notes.countPosts({})).toEqual({ count: 1 });
  });
});

describe('checks per call', () => {
  it('runs each function once per call', async () => {
    const { local, repos, calls } = setup();
    const [own] = await notesOf(repos, 'u1', [1]);
    const id = own?.id ?? '';

    await local.notes.get({ id });
    await local.notes.update({ id, rank: 2 });
    await local.notes.rename({ id, title: 'r' });
    await local.notes.create({ ownerId: 'u1', title: 't', rank: 1 });

    expect(calls).toEqual({ read: 1, update: 1, rename: 1, create: 1 });
  });

  it('keeps no answer between calls on one createLocalClient context', async () => {
    const { local, repos, calls } = setup();
    const [own] = await notesOf(repos, 'u1', [1]);
    const id = own?.id ?? '';

    await Promise.all([local.notes.get({ id }), local.notes.get({ id })]);

    expect(calls.read).toBe(2);
  });

  it('a direct execute call uses build().context', async () => {
    const { useCases, context, repos } = setup();
    const [theirs] = await notesOf(repos, 'u2', [1]);

    const call = useCases.notes.get.execute(context(callContext()), {
      id: theirs?.id ?? '',
    });

    expect(await codeOf(call)).toBe('NOT_FOUND');
  });
});

describe('a Repo', () => {
  it('throws on a Scope for another collection', async () => {
    const { repos, context } = setup();
    const postsScope = await context(callContext()).access.scope(Posts, 'get');

    // @ts-expect-error a Scope<'posts'> is not a notes scope
    const wrong = repos.notes.get('n1', postsScope);

    await expect(wrong).rejects.toThrow(
      'Lattice: the "notes" repo was given a scope for "posts"',
    );
  });
});

describe('build({ access })', () => {
  it('replaces the functions given at .collection()', async () => {
    const requests: AccessRequest<Actor>[] = [];
    class Recording extends Adapter(Access) {
      override async check(request: AccessRequest<Actor>) {
        requests.push(request);
        return { rank: { gt: 1 } };
      }
    }
    const { app, repos } = framework({ family: AppUseCase })
      .collection(Notes, { access: {} })
      .build({
        store: new MemoryStore(),
        events: noEvents,
        access: new Recording(),
      });
    await notesOf(repos, 'u1', [1, 2]);
    const local = createLocalClient(app, { context: callContext() });

    const page = await local.notes.find({});

    expect(page.docs.map((doc) => doc.rank)).toEqual([2]);
    expect(requests).toEqual([{ actor, collection: 'notes', action: 'find' }]);
  });
});

describe('type errors', () => {
  /** Statements the compiler checks and the test never runs. */
  function typeOnly(_statements: () => unknown): void {}

  it('a declared method needs an access function', () => {
    typeOnly(() =>
      // @ts-expect-error notes.rename has no access function; it is always FORBIDDEN
      framework({ family: AppUseCase }).collection(Notes, {
        access: {},
        methods: { rename: RenameNote },
      }),
    );
  });

  it('a Where on an unknown field', () => {
    typeOnly(() =>
      // @ts-expect-error access.read filters on "owner", which notes does not have
      framework({ family: AppUseCase }).collection(Notes, {
        access: {
          read: ({ actor }) => ({
            rank: { gt: 1 },
            owner: { eq: actor.userId },
          }),
        },
      }),
    );
  });

  it('an unknown operator, an operand of the wrong type, an unknown action and a Where on create', () => {
    typeOnly(() => [
      framework({ family: AppUseCase }).collection(Notes, {
        access: {
          // @ts-expect-error "equals" is not an operator
          read: () => ({ title: { equals: 'x' } }),
        },
      }),
      framework({ family: AppUseCase }).collection(Notes, {
        access: {
          // @ts-expect-error rank is a number
          read: () => ({ rank: { eq: 'high' } }),
        },
      }),
      // @ts-expect-error "publish" is not an action of notes
      framework({ family: AppUseCase }).collection(Notes, {
        access: { publish: () => true },
      }),
      framework({ family: AppUseCase }).collection(Notes, {
        access: {
          // @ts-expect-error create has no row to filter
          create: () => ({ rank: { gt: 1 } }),
        },
      }),
    ]);
  });

  it('a missing access', () => {
    typeOnly(() =>
      // @ts-expect-error Property 'access' is missing
      framework({ family: AppUseCase }).collection(Notes, {}),
    );
  });

  it('a Repo call with a plain object for a scope', () => {
    typeOnly(() => {
      const { repos } = setup();
      // @ts-expect-error Property '#scope' is missing: a Scope is nominal
      return repos.notes.get('n1', { collection: 'notes', where: undefined });
    });
  });

  it('a Repo call with no scope', () => {
    typeOnly(() => {
      const { repos } = setup();
      // @ts-expect-error Expected 2 arguments, but got 1
      return repos.notes.get('n1');
    });
  });
});
