import { describe, expect, it } from 'vitest';
import { LatticeError } from './errors.js';
import { validationPaths } from './fixtures/validation.js';
import { type Doc, MemoryStore } from './store.js';

const post = (id: string, fields: Record<string, unknown> = {}): Doc => ({
  id,
  title: `Post ${id}`,
  status: 'draft',
  ...fields,
});

async function seeded(...docs: Doc[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const doc of docs) await store.insert('posts', doc);
  return store;
}

const drafts = { status: { eq: 'draft' } };
const published = { status: { eq: 'published' } };

describe('MemoryStore', () => {
  it('inserts and gets a doc; a missing id is null', async () => {
    const store = await seeded(post('p1'));
    expect(await store.get('posts', 'p1')).toEqual(post('p1'));
    expect(await store.get('posts', 'p2')).toBeNull();
    expect(await store.get('comments', 'p1')).toBeNull();
  });

  it('throws CONFLICT when inserting an existing id', async () => {
    const store = await seeded(post('p1'));
    const error = await store.insert('posts', post('p1')).catch((e) => e);
    expect(LatticeError.is(error) && error.code).toBe('CONFLICT');
    expect(error.data).toEqual({ collection: 'posts', id: 'p1' });
  });

  it('get honors where: a row outside it acts as missing', async () => {
    const store = await seeded(post('p1'));
    expect(await store.get('posts', 'p1', drafts)).toEqual(post('p1'));
    expect(await store.get('posts', 'p1', published)).toBeNull();
  });

  it('getMany returns matching docs in the order of ids, skipping missing ones', async () => {
    const store = await seeded(
      post('p1'),
      post('p2', { status: 'published' }),
      post('p3'),
    );
    expect(
      (await store.getMany('posts', ['p3', 'nope', 'p1', 'p2'])).map(
        (doc) => doc.id,
      ),
    ).toEqual(['p3', 'p1', 'p2']);
    expect(
      (await store.getMany('posts', ['p3', 'p2', 'p1'], drafts)).map(
        (doc) => doc.id,
      ),
    ).toEqual(['p3', 'p1']);
  });

  it('update merges shallowly, removes undefined keys and returns the doc', async () => {
    const store = await seeded(post('p1', { body: 'b', meta: { a: 1 } }));
    const updated = await store.update('posts', 'p1', {
      title: 'New',
      body: undefined,
      meta: { b: 2 },
    });
    const expected = {
      id: 'p1',
      title: 'New',
      status: 'draft',
      meta: { b: 2 },
    };
    expect(updated).toEqual(expected);
    expect(await store.get('posts', 'p1')).toEqual(expected);
    expect(Object.hasOwn(updated ?? {}, 'body')).toBe(false);
  });

  it('update returns null for a missing id or a row outside where, and changes nothing', async () => {
    const store = await seeded(post('p1'));
    expect(await store.update('posts', 'p2', { title: 'x' })).toBeNull();
    expect(
      await store.update('posts', 'p1', { title: 'x' }, published),
    ).toBeNull();
    expect(await store.get('posts', 'p1')).toEqual(post('p1'));
    expect(await store.update('posts', 'p1', { title: 'x' }, drafts)).toEqual(
      post('p1', { title: 'x' }),
    );
  });

  it('remove returns the removed doc, or null for a missing id or a row outside where', async () => {
    const store = await seeded(post('p1'), post('p2'));
    expect(await store.remove('posts', 'p1', published)).toBeNull();
    expect(await store.get('posts', 'p1')).toEqual(post('p1'));
    expect(await store.remove('posts', 'p1', drafts)).toEqual(post('p1'));
    expect(await store.get('posts', 'p1')).toBeNull();
    expect(await store.remove('posts', 'p1')).toBeNull();
    expect(await store.remove('posts', 'p2')).toEqual(post('p2'));
  });

  it('find filters by where', async () => {
    const store = await seeded(
      post('p1'),
      post('p2', { status: 'published' }),
      post('p3'),
    );
    const page = await store.find({
      collection: 'posts',
      where: drafts,
      sort: ['id'],
      limit: 10,
    });
    expect(page.docs.map((doc) => doc.id)).toEqual(['p1', 'p3']);
    expect(page.next).toBeNull();
  });

  it('stores copies: mutating an argument or a returned doc changes nothing', async () => {
    const original = post('p1', { meta: { tags: ['a'] } });
    const arg: { id: string; [field: string]: unknown } =
      structuredClone(original);
    const store = await seeded(arg);
    arg.meta = 'changed';

    const got = await store.get('posts', 'p1');
    if (got === null) throw new Error('missing');
    Object.assign(got, { title: 'changed' });
    const [many] = await store.getMany('posts', ['p1']);
    Object.assign(many ?? {}, { title: 'changed' });
    const [found] = (
      await store.find({ collection: 'posts', sort: [], limit: 1 })
    ).docs;
    Object.assign(found ?? {}, { title: 'changed' });

    const patch = { meta: { tags: ['b'] } };
    const updated = await store.update('posts', 'p1', patch);
    patch.meta.tags.push('mutated');
    Object.assign(updated ?? {}, { title: 'changed' });

    expect(await store.get('posts', 'p1')).toEqual(
      post('p1', { meta: { tags: ['b'] } }),
    );
  });
});

describe('pagination', () => {
  // Ties on purpose: a has three values and b two across twelve docs.
  const docs: Doc[] = Array.from({ length: 12 }, (_, i) => ({
    id: `d${String(i).padStart(2, '0')}`,
    a: i % 3,
    b: ['x', 'y'][i % 2],
  }));

  /** The order the test expects, written without the store's code. */
  function expected(sort: readonly string[]): string[] {
    const keys = sort.map((key) =>
      key.startsWith('-')
        ? { field: key.slice(1), dir: -1 }
        : { field: key, dir: 1 },
    );
    if (!keys.some((key) => key.field === 'id')) {
      keys.push({ field: 'id', dir: 1 });
    }
    return [...docs]
      .sort((x, y) => {
        for (const { field, dir } of keys) {
          const [p, q] = [String(x[field]), String(y[field])];
          if (p !== q) return p < q ? -dir : dir;
        }
        return 0;
      })
      .map((doc) => doc.id);
  }

  async function pages(
    store: MemoryStore,
    sort: readonly string[],
    limit: number,
  ) {
    const seen: string[][] = [];
    let after: string | undefined;
    for (;;) {
      const page = await store.find({
        collection: 'docs',
        sort,
        limit,
        ...(after === undefined ? {} : { after }),
      });
      seen.push(page.docs.map((doc) => doc.id));
      if (page.next === null) return seen;
      after = page.next;
    }
  }

  const sorts = [
    [],
    ['a'],
    ['-a'],
    ['a', 'b'],
    ['a', '-b'],
    ['-a', 'b'],
    ['-a', '-b'],
    ['b', '-a'],
    ['-id'],
    ['-b', 'id', 'a'],
  ];

  it.each(sorts)(
    'yields each doc once, in order, sorting by %j',
    async (...sort) => {
      const store = new MemoryStore();
      for (const doc of docs) await store.insert('docs', doc);
      for (const limit of [1, 2, 5, 12, 20]) {
        const seen = await pages(store, sort, limit);
        expect(seen.flat()).toEqual(expected(sort));
        expect(seen.every((page) => page.length <= limit)).toBe(true);
        expect(seen.slice(0, -1).every((page) => page.length === limit)).toBe(
          true,
        );
      }
    },
  );

  it('next is null on the last page, even when it is full', async () => {
    const store = new MemoryStore();
    for (const doc of docs) await store.insert('docs', doc);
    const seen = await pages(store, ['a'], 4);
    expect(seen.map((page) => page.length)).toEqual([4, 4, 4]);
  });

  it('rejects a cursor from another sort, or a malformed one, with VALIDATION', async () => {
    const store = new MemoryStore();
    for (const doc of docs) await store.insert('docs', doc);
    const first = await store.find({
      collection: 'docs',
      sort: ['a'],
      limit: 2,
    });
    const next = first.next ?? '';
    const find = (sort: readonly string[], after: string) =>
      store.find({ collection: 'docs', sort, limit: 2, after });
    const paths = async (sort: readonly string[], after: string) => {
      const error = await find(sort, after).catch((e) => e);
      return validationPaths(() => {
        throw error;
      });
    };
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    expect(await paths(['-a'], next)).toEqual([['after']]);
    expect(await paths(['a', 'b'], next)).toEqual([['after']]);
    expect(await paths(['a'], 'not a cursor')).toEqual([['after']]);
    expect(await paths(['a'], encode({ sort: ['a', 'id'] }))).toEqual([
      ['after'],
    ]);
    expect(
      await paths(['a'], encode({ sort: ['a', 'id'], values: [1] })),
    ).toEqual([['after']]);
    expect(
      await paths(['a'], encode({ sort: ['a', 'id'], values: [1, {}] })),
    ).toEqual([['after']]);
    expect((await find(['a'], next)).docs).toHaveLength(2);
  });
});
