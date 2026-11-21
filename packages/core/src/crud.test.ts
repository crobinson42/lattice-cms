import { isPFError } from '@ts-pf/protocol';
import { createLocalClient } from '@ts-pf/server';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from 'vitest';
import { z } from 'zod';
import { operations } from './collection.js';
import { AppUseCase, callContext } from './fixtures/context.js';
import { noSubscribers } from './fixtures/events.js';
import { collection, framework, MemoryStore } from './index.js';
import type { FindQuery, Patch, StoredDoc } from './store.js';
import type { AnyWhere } from './where.js';

/** Every call the generated use cases make, in order. */
let calls: string[] = [];

const schema = z.object({
  // The refine records each time the input is validated.
  title: z.string().refine(() => {
    calls.push('validate');
    return true;
  }),
  body: z.string().default(''),
  status: z.enum(['draft', 'published']).default('draft'),
  views: z.number().int().default(0),
  pinned: z.boolean().optional(),
});

const Notes = collection('notes', { schema });

type Note = z.output<typeof Notes.output>;

/** A MemoryStore that records each read and write, and the patches it gets. */
class RecordingStore extends MemoryStore {
  patches: Patch[] = [];

  override async find(query: FindQuery) {
    calls.push('read');
    return super.find(query);
  }
  override async get(collection: string, id: string, where?: AnyWhere) {
    calls.push('read');
    return super.get(collection, id, where);
  }
  override async insert(collection: string, doc: StoredDoc) {
    calls.push('write');
    return super.insert(collection, doc);
  }
  override async update(
    collection: string,
    id: string,
    patch: Patch,
    where?: AnyWhere,
  ) {
    calls.push('write');
    this.patches.push(patch);
    return super.update(collection, id, patch, where);
  }
  override async remove(collection: string, id: string, where?: AnyWhere) {
    calls.push('write');
    return super.remove(collection, id, where);
  }
}

function setup(notes = Notes) {
  const store = new RecordingStore();
  const { app } = framework({
    family: AppUseCase,
    store,
    events: noSubscribers,
  })
    .collection(notes)
    .build();
  const local = createLocalClient(app, { context: callContext() });
  return { store, local };
}

const note = {
  title: 'Hello',
  body: 'B',
  status: 'published',
  views: 5,
} as const;

/** The error a client call fails with, as the client receives it. */
async function failure(call: Promise<unknown>) {
  const error = await call.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!isPFError(error)) throw new Error('expected a PFError');
  return { code: error.code, data: error.data };
}

beforeEach(() => {
  calls = [];
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('generated operations on MemoryStore', () => {
  it('create sets id, createdAt and updatedAt and returns the stored doc', async () => {
    const { local } = setup();
    const created = await local.notes.create(note);
    expect(created).toEqual({
      ...note,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(await local.notes.get({ id: created.id })).toEqual(created);
  });

  it('create takes a defaulted field as optional, and the handler gets its default', async () => {
    const seen: unknown[] = [];
    const { local } = setup(
      Notes.hooks({
        beforeChange: ({ data }) => {
          seen.push(data);
          return data;
        },
      }),
    );

    expectTypeOf(local.notes.create).parameter(0).toEqualTypeOf<{
      title: string;
      body?: string | undefined;
      status?: 'draft' | 'published' | undefined;
      views?: number | undefined;
      pinned?: boolean | undefined;
    }>();
    const created = await local.notes.create({ title: 'Hello' });

    expect(seen).toEqual([
      { title: 'Hello', body: '', status: 'draft', views: 0 },
    ]);
    expect(created).toMatchObject({ body: '', status: 'draft', views: 0 });
  });

  it('a client cannot supply system fields', async () => {
    const { local } = setup();
    const created = await local.notes.create({
      ...note,
      // @ts-expect-error id is not input
      id: 'mine',
      createdAt: '1999-01-01T00:00:00.000Z',
    });
    expect(created.id).not.toBe('mine');
    expect(created.createdAt).toBe('2026-01-01T00:00:00.000Z');

    const updated = await local.notes.update({
      id: created.id,
      // @ts-expect-error createdAt is not input
      createdAt: '1999-01-01T00:00:00.000Z',
    });
    expect(updated.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('update is a partial patch: it bumps updatedAt and leaves defaulted fields alone', async () => {
    const { local, store } = setup();
    const created = await local.notes.create(note);
    vi.setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

    const updated = await local.notes.update({
      id: created.id,
      title: 'New',
    });

    expect(updated).toEqual({
      ...created,
      title: 'New',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(await local.notes.get({ id: created.id })).toEqual(updated);
    // Only the changed field and updatedAt reach the store.
    expect(store.patches).toEqual([
      { title: 'New', updatedAt: '2026-01-02T00:00:00.000Z' },
    ]);
  });

  it('delete returns the removed doc, and the doc is gone', async () => {
    const { local } = setup();
    const created = await local.notes.create(note);
    expect(await local.notes.delete({ id: created.id })).toEqual(created);
    expect((await failure(local.notes.get({ id: created.id }))).code).toBe(
      'NOT_FOUND',
    );
  });

  it('get, update and delete on a missing id throw NOT_FOUND', async () => {
    const { local } = setup();
    const missing = {
      code: 'NOT_FOUND',
      data: { collection: 'notes', id: 'nope' },
    };
    expect(await failure(local.notes.get({ id: 'nope' }))).toEqual(missing);
    expect(
      await failure(local.notes.update({ id: 'nope', title: 'x' })),
    ).toEqual(missing);
    expect(await failure(local.notes.delete({ id: 'nope' }))).toEqual(missing);
  });

  it('find filters, sorts and pages through the use case', async () => {
    const { local } = setup();
    for (const views of [1, 2, 3, 4, 5]) {
      await local.notes.create({ ...note, views });
    }
    const where = { views: { gte: 2 } } as const;
    const first = await local.notes.find({ where, sort: ['-views'], limit: 2 });
    expect(first.docs.map((doc) => doc.views)).toEqual([5, 4]);
    if (first.next === null) throw new Error('expected a next page');

    const second = await local.notes.find({
      where,
      sort: ['-views'],
      limit: 2,
      after: first.next,
    });
    expect(second.docs.map((doc) => doc.views)).toEqual([3, 2]);
    expect(second.next).toBeNull();
  });

  it('find defaults to the newest 20', async () => {
    const { local } = setup();
    for (let i = 0; i < 25; i += 1) {
      vi.setSystemTime(new Date(Date.UTC(2026, 0, 1, 0, i)));
      await local.notes.create({ ...note, views: i });
    }
    const page = await local.notes.find({});
    expect(page.docs).toHaveLength(20);
    expect(page.docs.map((doc) => doc.views)).toEqual(
      Array.from({ length: 20 }, (_, i) => 24 - i),
    );
    expect(page.next).not.toBeNull();
  });
});

/** Calls in order, with repeats of one step collapsed. */
function steps(): string[] {
  return calls.filter((call, i) => call !== calls[i - 1]);
}

describe('hooks', () => {
  it('run in order: validate, beforeChange, write, afterRead', async () => {
    const hooked = Notes.hooks({
      beforeChange: ({ data }) => {
        calls.push('beforeChange');
        return data;
      },
      afterRead: ({ doc }) => {
        calls.push('afterRead');
        return doc;
      },
    });
    const { local } = setup(hooked);

    const created = await local.notes.create(note);
    expect(steps()).toEqual(['validate', 'beforeChange', 'write', 'afterRead']);

    calls = [];
    await local.notes.update({ id: created.id, title: 'New' });
    // The patch is validated, then the merged document.
    expect(steps()).toEqual([
      'validate',
      'read',
      'validate',
      'beforeChange',
      'write',
      'afterRead',
    ]);

    calls = [];
    await local.notes.delete({ id: created.id });
    expect(steps()).toEqual(['write', 'afterRead']);
  });

  it('afterRead runs on every returned doc, find included', async () => {
    const hooked = Notes.hooks({
      afterRead: ({ doc }) => ({ ...doc, title: `${doc.title}!` }),
    });
    const { local, store } = setup(hooked);
    const created = await local.notes.create(note);
    expect(created.title).toBe('Hello!');
    await local.notes.create(note);
    await local.notes.create(note);

    const page = await local.notes.find({});
    expect(page.docs.map((doc) => doc.title)).toEqual([
      'Hello!',
      'Hello!',
      'Hello!',
    ]);
    expect((await local.notes.get({ id: created.id })).title).toBe('Hello!');
    expect((await local.notes.update({ id: created.id, views: 9 })).title).toBe(
      'Hello!',
    );
    expect((await local.notes.delete({ id: created.id })).title).toBe('Hello!');
    // afterRead shapes what callers see, not what is stored.
    const kept = page.docs.find((doc) => doc.id !== created.id);
    expect((await store.get('notes', kept?.id ?? ''))?.title).toBe('Hello');
  });

  it('beforeChange gets the merged document on update, and its result is written', async () => {
    const seen: unknown[] = [];
    const hooked = Notes.hooks({
      beforeChange: (args) => {
        seen.push(args);
        return { ...args.data, title: args.data.title.trim() };
      },
    });
    const { local } = setup(hooked);

    const created = await local.notes.create({ ...note, title: '  Hello  ' });
    expect(created.title).toBe('Hello');

    const updated = await local.notes.update({
      id: created.id,
      title: '  New  ',
    });
    expect(updated.title).toBe('New');
    expect(seen[1]).toEqual({
      operation: 'update',
      data: { title: '  New  ', body: 'B', status: 'published', views: 5 },
      previous: created,
    });
  });

  it('may be async', async () => {
    const hooked = Notes.hooks({
      beforeChange: async ({ data }) => ({ ...data, views: data.views + 1 }),
      afterRead: async ({ doc }) => ({ ...doc, body: doc.body.toUpperCase() }),
    });
    const { local } = setup(hooked);
    expect(await local.notes.create(note)).toMatchObject({
      views: 6,
      body: 'B',
    });
  });

  it('are typed from the schema with no annotation', () => {
    Notes.hooks({
      beforeChange: (args) => {
        expectTypeOf(args.data).toEqualTypeOf<{
          title: string;
          body: string;
          status: 'draft' | 'published';
          views: number;
          pinned?: boolean | undefined;
        }>();
        if (args.operation === 'update') {
          expectTypeOf(args.previous).toEqualTypeOf<Note>();
        }
        return { ...args.data, title: args.data.title.trim() };
      },
      afterRead: ({ doc }) => {
        expectTypeOf(doc).toEqualTypeOf<Note>();
        return doc;
      },
    });
  });

  it('must return the right shape', () => {
    Notes.hooks({
      // @ts-expect-error title is a string
      beforeChange: ({ data }) => ({ ...data, title: 1 }),
    });
    Notes.hooks({
      // @ts-expect-error the data needs every field
      beforeChange: () => ({ title: 'x' }),
    });
    Notes.hooks({
      // @ts-expect-error id is a string
      afterRead: ({ doc }) => ({ ...doc, id: 1 }),
    });
  });
});

describe('update validates the merged document', () => {
  const Deals = collection('deals', {
    schema: z
      .object({
        title: z.string(),
        openDate: z.string(),
        closeDate: z.string(),
      })
      .refine((deal) => deal.closeDate >= deal.openDate, {
        path: ['closeDate'],
        message: 'closeDate is before openDate',
      }),
  });

  function deals() {
    const store = new MemoryStore();
    const { app } = framework({
      family: AppUseCase,
      store,
      events: noSubscribers,
    })
      .collection(Deals)
      .build();
    return { store, local: createLocalClient(app, { context: callContext() }) };
  }

  const deal = {
    title: 'D',
    openDate: '2026-02-01',
    closeDate: '2026-03-01',
  };

  it('create rejects a doc that breaks the refinement', async () => {
    const { local } = deals();
    await expect(
      local.deals.create({ ...deal, closeDate: '2026-01-01' }),
    ).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('update rejects a patch that makes the merged doc break it, with its path', async () => {
    const { local, store } = deals();
    const created = await local.deals.create(deal);
    const error = await failure(
      local.deals.update({ id: created.id, closeDate: '2026-01-01' }),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.data).toEqual({
      issues: [
        { path: ['closeDate'], message: 'closeDate is before openDate' },
      ],
    });
    expect(await store.get('deals', created.id)).toEqual(created);
  });

  it('update accepts a patch that keeps the merged doc valid', async () => {
    const { local } = deals();
    const created = await local.deals.create(deal);
    const updated = await local.deals.update({
      id: created.id,
      closeDate: '2026-04-01',
    });
    expect(updated.closeDate).toBe('2026-04-01');
  });

  it('drops a stored key the schema no longer has', async () => {
    const { local, store } = setup();
    const created = await local.notes.create(note);
    // A field an older version of the schema had.
    await store.update('notes', created.id, { legacy: 'old' });

    const updated = await local.notes.update({ id: created.id, views: 9 });

    expect(updated).not.toHaveProperty('legacy');
    expect(await store.get('notes', created.id)).not.toHaveProperty('legacy');
    expect(store.patches.at(-1)).toEqual({
      views: 9,
      legacy: undefined,
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('a patch never applies a default', () => {
  const Wrapped = collection('wrapped', {
    schema: z.object({
      title: z.string(),
      caught: z.string().default('c').catch('fallback'),
      frozen: z.string().default('r').readonly(),
      required: z.string().default('n').nonoptional(),
      chained: z.string().default('x').nullable().optional(),
    }),
  });

  it.each(['caught', 'frozen', 'required', 'chained'] as const)(
    'leaves %s as stored when the patch omits it',
    async (field) => {
      const { app } = framework({
        family: AppUseCase,
        store: new MemoryStore(),
        events: noSubscribers,
      })
        .collection(Wrapped)
        .build();
      const local = createLocalClient(app, { context: callContext() });
      const created = await local.wrapped.create({
        title: 't',
        caught: 'C1',
        frozen: 'R1',
        required: 'N1',
        chained: 'X1',
      });
      const updated = await local.wrapped.update({
        id: created.id,
        title: 'u',
      });
      expect(updated[field]).toBe(created[field]);
    },
  );
});

describe('caller input types', () => {
  function built() {
    return framework({
      family: AppUseCase,
      store: new MemoryStore(),
      events: noSubscribers,
    })
      .collection(Notes)
      .build();
  }

  it('find’s input schema carries the default sort and limit', () => {
    const first = operations(Notes.schema).find.input.parse({});
    const second = operations(Notes.schema).find.input.parse({});
    expect(first).toEqual({ sort: ['-createdAt'], limit: 20 });
    // Each parse gets its own array, so a caller that mutates one changes no other.
    expect(first.sort).not.toBe(second.sort);
  });

  it('a client and a direct useCases call take the same input type', () => {
    const { app, useCases } = built();
    const local = createLocalClient(app, { context: callContext() });
    type Client = typeof local.notes;
    type Direct = typeof useCases.notes;

    expectTypeOf<Parameters<Direct['find']['execute']>[1]>().toEqualTypeOf<
      Parameters<Client['find']>[0]
    >();
    expectTypeOf<Parameters<Direct['get']['execute']>[1]>().toEqualTypeOf<
      Parameters<Client['get']>[0]
    >();
    expectTypeOf<Parameters<Direct['create']['execute']>[1]>().toEqualTypeOf<
      Parameters<Client['create']>[0]
    >();
    expectTypeOf<Parameters<Direct['update']['execute']>[1]>().toEqualTypeOf<
      Parameters<Client['update']>[0]
    >();
    expectTypeOf<Parameters<Direct['delete']['execute']>[1]>().toEqualTypeOf<
      Parameters<Client['delete']>[0]
    >();
  });
});
