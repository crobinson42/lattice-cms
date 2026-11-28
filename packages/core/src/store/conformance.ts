/**
 * `@latticecms/core/store/conformance`: the cases every `CollectionStore`
 * adapter passes. They are data, asserted with `node:assert`, so an adapter
 * runs them in any test runner with a fresh store per case:
 *
 * ```ts
 * it.each(storeCases)('$name', ({ run }) => run(store));
 * ```
 *
 * A store without transactions runs the cases that do not need them:
 * `storeCases.filter((c) => !c.needs?.includes('transactions'))`.
 *
 * Each case uses its own collection names. A store's semantics follow
 * MongoDB's query rules; `MemoryStore` passes every case.
 */
import assert from 'node:assert/strict';
import { inspect, isDeepStrictEqual } from 'node:util';
import { LatticeError } from '../errors.js';
import type { CollectionStore, Index, Patch, StoredDoc } from '../store.js';
import type { AnyWhere } from '../where.js';

/** A capability some stores lack. A case that needs one says so. */
export type StoreCapability = 'transactions';

/** One conformance case: its name, and the check it runs on a fresh store. */
export type StoreCase = {
  readonly name: string;
  /**
   * What the store must support for this case. An adapter that lacks a
   * capability filters these cases out.
   */
  readonly needs?: readonly StoreCapability[];
  run(store: CollectionStore): Promise<void>;
};

function show(value: unknown): string {
  return inspect(value, { depth: 8, breakLength: Number.POSITIVE_INFINITY });
}

/** Fails, naming `what` and the expected value, unless they are deeply equal. */
function same(actual: unknown, expected: unknown, what: string): void {
  if (!isDeepStrictEqual(actual, expected)) {
    assert.fail(`${what}: expected ${show(expected)}, got ${show(actual)}`);
  }
}

/** What `promise` rejected with, or fails when it resolves. */
async function rejection(
  promise: Promise<unknown>,
  what: string,
): Promise<unknown> {
  const outcome = await promise.then(
    (value) => ({ resolved: true, value }),
    (error: unknown) => ({ resolved: false, value: error }),
  );
  if (outcome.resolved) {
    assert.fail(`${what}: expected a rejection, got ${show(outcome.value)}`);
  }
  return outcome.value;
}

/**
 * Fails unless `promise` rejects with Lattice's CONFLICT for `id`, naming
 * the clashing index's `fields`.
 */
async function conflict(
  promise: Promise<unknown>,
  collection: string,
  id: string,
  fields: readonly string[],
  what: string,
): Promise<void> {
  const error = await rejection(promise, what);
  same(
    LatticeError.is(error) ? { code: error.code, data: error.data } : error,
    { code: 'CONFLICT', data: { collection, id, fields } },
    what,
  );
}

async function seed(
  store: CollectionStore,
  collection: string,
  docs: readonly StoredDoc[],
): Promise<void> {
  for (const doc of docs) await store.insert(collection, doc);
}

function idsOf(docs: readonly StoredDoc[]): string[] {
  return docs.map((doc) => doc.id);
}

/** The ids `where` finds in `collection`, by id. */
async function found(
  store: CollectionStore,
  collection: string,
  where: AnyWhere,
): Promise<string[]> {
  const page = await store.find({
    collection,
    where,
    sort: ['id'],
    optional: [],
    limit: 100,
  });
  return idsOf(page.docs);
}

/** Every page of a find, as ids. */
async function pages(
  store: CollectionStore,
  collection: string,
  sort: readonly string[],
  limit: number,
  where?: AnyWhere,
  optional: readonly string[] = [],
): Promise<string[][]> {
  const seen: string[][] = [];
  let after: string | undefined;
  for (;;) {
    const page = await store.find({
      collection,
      sort,
      optional,
      limit,
      ...(where === undefined ? {} : { where }),
      ...(after === undefined ? {} : { after }),
    });
    seen.push(idsOf(page.docs));
    if (page.next === null) return seen;
    after = page.next;
  }
}

const post = (id: string, fields: Record<string, unknown> = {}): StoredDoc => ({
  id,
  title: `Post ${id}`,
  status: 'draft',
  ...fields,
});

const drafts = { status: { eq: 'draft' } };
const published = { status: { eq: 'published' } };

/**
 * Documents for the `Where` cases. `note` is a string, null or missing;
 * `flag` is a boolean or missing; `tags` and `meta` are an array and an
 * object; `at` is an ISO timestamp or missing.
 */
const things: readonly StoredDoc[] = [
  {
    id: 't1',
    name: 'Alpha',
    n: 1,
    flag: true,
    note: 'x',
    tags: ['a'],
    meta: { k: 1 },
    at: '2026-01-02T00:00:00.000Z',
  },
  {
    id: 't2',
    name: 'beta',
    n: 2,
    flag: false,
    note: null,
    tags: [],
    at: '2026-01-10T00:00:00.000Z',
  },
  { id: 't3', name: 'Gamma (a.b*)', n: 3, at: '2025-12-31T00:00:00.000Z' },
  { id: 't4', name: 'delta\\', n: 10, flag: true, note: 'y' },
];

/** A case that seeds `things` and checks what each filter finds. */
function whereCase(
  name: string,
  expectations: readonly (readonly [AnyWhere, readonly string[]])[],
): StoreCase {
  return {
    name: `where: ${name}`,
    async run(store) {
      await seed(store, 'where_things', things);
      for (const [where, ids] of expectations) {
        same(
          await found(store, 'where_things', where),
          ids,
          `find with ${show(where)}`,
        );
      }
    },
  };
}

// Twelve documents with ties: `a` has three values and `b` two.
const tied: readonly StoredDoc[] = Array.from({ length: 12 }, (_, i) => ({
  id: `d${String(i).padStart(2, '0')}`,
  a: i % 3,
  b: ['x', 'y'][i % 2],
  keep: i % 4 !== 0,
}));

/** The order of `docs` under `sort`, written without any store's code. */
function expectedOrder(
  docs: readonly StoredDoc[],
  sort: readonly string[],
): string[] {
  const keys = sort.map((key) =>
    key.startsWith('-')
      ? { field: key.slice(1), dir: -1 }
      : { field: key, dir: 1 },
  );
  if (!keys.some((key) => key.field === 'id'))
    keys.push({ field: 'id', dir: 1 });
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

const sorts: readonly (readonly string[])[] = [
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

/** Fails unless the paged ids are `expected`, in full pages but the last. */
function checkPages(
  seen: readonly string[][],
  expected: readonly string[],
  limit: number,
  what: string,
): void {
  same(seen.flat(), expected, `${what}: every doc once, in order`);
  same(
    seen.slice(0, -1).every((page) => page.length === limit) &&
      seen.every((page) => page.length <= limit),
    true,
    `${what}: pages of ${limit}, a shorter one only last (got ${show(seen.map((page) => page.length))})`,
  );
}

/**
 * Eleven documents for sorts on optional fields: `due` is a date, null,
 * missing or explicitly undefined, and `note` a string, null or missing,
 * with ties on each; `rank` is a required number that ties.
 */
const dated: readonly StoredDoc[] = [
  { id: 'e00', due: '2026-01-03', rank: 1, note: 'b' },
  { id: 'e01', rank: 2, note: 'a' },
  { id: 'e02', due: '2026-01-01', rank: 1 },
  { id: 'e03', due: null, rank: 1, note: 'a' },
  { id: 'e04', due: '2026-01-03', rank: 2, note: null },
  { id: 'e05', rank: 1, note: 'b' },
  { id: 'e06', due: '2026-01-02', rank: 2 },
  { id: 'e07', due: '2026-01-01', rank: 2, note: 'a' },
  { id: 'e08', due: null, rank: 2, note: 'b' },
  { id: 'e09', rank: 1, note: null },
  { id: 'e10', due: undefined, rank: 2, note: 'a' },
];

/** The optional fields of `dated`. */
const datedOptional = ['due', 'note'];

/**
 * The order of `docs` under `sort`, with a missing or null value after
 * every value in either direction, written without any store's code.
 */
function expectedMissingLast(
  docs: readonly StoredDoc[],
  sort: readonly string[],
): string[] {
  const keys = sort.map((key) =>
    key.startsWith('-')
      ? { field: key.slice(1), dir: -1 }
      : { field: key, dir: 1 },
  );
  keys.push({ field: 'id', dir: 1 });
  return [...docs]
    .sort((x, y) => {
      for (const { field, dir } of keys) {
        const [p, q] = [x[field] ?? null, y[field] ?? null];
        if (p === q) continue;
        if (p === null) return 1;
        if (q === null) return -1;
        return String(p) < String(q) ? -dir : dir;
      }
      return 0;
    })
    .map((doc) => doc.id);
}

/**
 * Sorts on `dated`, each with the plan MongoStore takes for it: a plain
 * sort when no ascending key is optional, two phases when only the first
 * key is, and a computed key otherwise.
 */
const optionalSorts: readonly (readonly string[])[] = [
  ['due'], // two phases
  ['-due'], // plain
  ['due', '-rank'], // two phases
  ['-due', 'rank'], // plain
  ['rank', 'due'], // computed
  ['-rank', '-due'], // plain
  ['due', 'note'], // computed, two flags
  ['-due', '-note'], // plain: a nested or after an exists: false prefix
  ['due', '-note'], // two phases, then a descending optional key
  ['-due', 'note'], // computed
  ['note', '-due'], // two phases on note
];

export const storeCases: readonly StoreCase[] = [
  // ---------------------------------------------------------------- methods
  {
    name: 'insert and get; a missing id is null',
    async run(store) {
      await seed(store, 'm_get', [post('p1')]);
      same(await store.get('m_get', 'p1'), post('p1'), 'get p1');
      same(await store.get('m_get', 'p2'), null, 'get a missing id');
      same(
        await store.get('m_get_other', 'p1'),
        null,
        'get from another collection',
      );
    },
  },
  {
    name: 'insert of an existing id is CONFLICT',
    async run(store) {
      await seed(store, 'm_conflict', [post('p1')]);
      await conflict(
        store.insert('m_conflict', post('p1', { title: 'again' })),
        'm_conflict',
        'p1',
        ['id'],
        'insert p1 twice',
      );
      same(
        await store.get('m_conflict', 'p1'),
        post('p1'),
        'p1 after the conflict',
      );
    },
  },
  {
    name: 'get with where: a row outside it is null',
    async run(store) {
      await seed(store, 'm_get_where', [post('p1')]);
      same(
        await store.get('m_get_where', 'p1', drafts),
        post('p1'),
        'get inside where',
      );
      same(
        await store.get('m_get_where', 'p1', published),
        null,
        'get outside where',
      );
    },
  },
  {
    name: 'a where on id never widens a call to another row',
    async run(store) {
      await seed(store, 'm_where_id', [post('p1'), post('p2')]);
      const notP1 = { id: { ne: 'p1' } };
      same(
        await store.get('m_where_id', 'p1', notP1),
        null,
        'get p1 where id is not p1',
      );
      same(
        await store.getMany('m_where_id', ['p1'], notP1),
        [],
        'getMany [p1] where id is not p1',
      );
      same(
        await store.update('m_where_id', 'p1', { title: 'x' }, notP1),
        null,
        'update p1 where id is not p1',
      );
      same(
        await store.remove('m_where_id', 'p1', notP1),
        null,
        'remove p1 where id is not p1',
      );
      same(
        await store.get('m_where_id', 'p1', { id: { eq: 'p2' } }),
        null,
        'get p1 where id is p2',
      );
      same(await store.get('m_where_id', 'p2'), post('p2'), 'p2 untouched');
      same(await store.get('m_where_id', 'p1'), post('p1'), 'p1 untouched');
    },
  },
  {
    name: 'getMany returns docs in the order of ids, skipping missing ones and rows outside where',
    async run(store) {
      await seed(store, 'm_many', [
        post('p1'),
        post('p2', { status: 'published' }),
        post('p3'),
      ]);
      same(
        idsOf(await store.getMany('m_many', ['p3', 'nope', 'p1', 'p2'])),
        ['p3', 'p1', 'p2'],
        'getMany without where',
      );
      same(
        idsOf(await store.getMany('m_many', ['p3', 'p2', 'p1'], drafts)),
        ['p3', 'p1'],
        'getMany with where',
      );
    },
  },
  {
    name: 'update merges shallowly, removes undefined keys and returns the doc',
    async run(store) {
      await seed(store, 'm_update', [
        post('p1', { body: 'b', meta: { a: 1 } }),
      ]);
      const expected = {
        id: 'p1',
        title: 'New',
        status: 'draft',
        meta: { b: 2 },
      };
      same(
        await store.update('m_update', 'p1', {
          title: 'New',
          body: undefined,
          meta: { b: 2 },
        }),
        expected,
        'the updated doc',
      );
      same(await store.get('m_update', 'p1'), expected, 'the stored doc');
    },
  },
  {
    name: 'update of a missing id or a row outside where is null, and changes nothing',
    async run(store) {
      await seed(store, 'm_update_where', [post('p1')]);
      same(
        await store.update('m_update_where', 'p2', { title: 'x' }),
        null,
        'update a missing id',
      );
      same(
        await store.update('m_update_where', 'p1', { title: 'x' }, published),
        null,
        'update outside where',
      );
      same(
        await store.get('m_update_where', 'p1'),
        post('p1'),
        'p1 after both',
      );
      same(
        await store.update('m_update_where', 'p1', { title: 'x' }, drafts),
        post('p1', { title: 'x' }),
        'update inside where',
      );
    },
  },
  {
    name: 'update never changes id',
    async run(store) {
      await seed(store, 'm_update_id', [post('p1')]);
      // A JavaScript caller can pass an id the Patch type forbids.
      const patch: Patch = JSON.parse('{"id":"p9","title":"x"}');
      same(
        await store.update('m_update_id', 'p1', patch),
        post('p1', { title: 'x' }),
        'update with an id in the patch',
      );
      same(await store.get('m_update_id', 'p9'), null, 'no doc p9');
    },
  },
  {
    name: 'remove returns the doc; a missing id or a row outside where is null',
    async run(store) {
      await seed(store, 'm_remove', [post('p1'), post('p2')]);
      same(
        await store.remove('m_remove', 'p1', published),
        null,
        'remove outside where',
      );
      same(await store.get('m_remove', 'p1'), post('p1'), 'p1 after it');
      same(
        await store.remove('m_remove', 'p1', drafts),
        post('p1'),
        'remove inside where',
      );
      same(await store.get('m_remove', 'p1'), null, 'p1 after removal');
      same(await store.remove('m_remove', 'p1'), null, 'remove p1 again');
      same(await store.remove('m_remove', 'p2'), post('p2'), 'remove p2');
    },
  },
  {
    name: 'find on an empty or unknown collection is an empty last page',
    async run(store) {
      same(
        await store.find({
          collection: 'm_none',
          sort: [],
          optional: [],
          limit: 10,
        }),
        { docs: [], next: null },
        'find on an unknown collection',
      );
    },
  },

  // ---------------------------------------------------------------- where
  whereCase('eq, ne, in and nin on strings, numbers and booleans', [
    [{ name: { eq: 'beta' } }, ['t2']],
    [{ name: { ne: 'beta' } }, ['t1', 't3', 't4']],
    [{ name: { in: ['Alpha', 'delta\\'] } }, ['t1', 't4']],
    [{ name: { nin: ['Alpha'] } }, ['t2', 't3', 't4']],
    [{ n: { eq: 2 } }, ['t2']],
    [{ n: { ne: 2 } }, ['t1', 't3', 't4']],
    [{ n: { in: [1, 3] } }, ['t1', 't3']],
    [{ n: { nin: [1, 3] } }, ['t2', 't4']],
    [{ flag: { eq: true } }, ['t1', 't4']],
    [{ flag: { eq: false } }, ['t2']],
    [{ flag: { in: [false] } }, ['t2']],
  ]),
  whereCase('gt, gte, lt and lte; numbers by value, strings by code unit', [
    [{ n: { gt: 2 } }, ['t3', 't4']],
    [{ n: { gte: 2 } }, ['t2', 't3', 't4']],
    [{ n: { lt: 3 } }, ['t1', 't2']],
    [{ n: { lte: 3 } }, ['t1', 't2', 't3']],
    // Upper case sorts before lower case by code unit.
    [{ name: { gt: 'Z' } }, ['t2', 't4']],
    [{ name: { lt: 'a' } }, ['t1', 't3']],
    [{ at: { gt: '2026-01-01T00:00:00.000Z' } }, ['t1', 't2']],
    [{ at: { lte: '2026-01-02T00:00:00.000Z' } }, ['t1', 't3']],
  ]),
  whereCase('null and missing: eq null, ne, nin and in', [
    [{ note: { eq: null } }, ['t2', 't3']],
    [{ note: { in: [null] } }, ['t2', 't3']],
    [{ note: { ne: null } }, ['t1', 't4']],
    [{ note: { nin: [null] } }, ['t1', 't4']],
    [{ note: { ne: 'x' } }, ['t2', 't3', 't4']],
    [{ note: { nin: ['x'] } }, ['t2', 't3', 't4']],
    [{ flag: { ne: true } }, ['t2', 't3']],
    [{ flag: { nin: [true] } }, ['t2', 't3']],
  ]),
  whereCase('a comparison with null or missing is false', [
    [{ note: { gt: 'a' } }, ['t1', 't4']],
    [{ note: { lt: 'z' } }, ['t1', 't4']],
    [{ at: { lt: '2027-01-01T00:00:00.000Z' } }, ['t1', 't2', 't3']],
  ]),
  {
    name: 'where: has matches an array with an equal element, nhas one without; a missing or null array has none',
    async run(store) {
      await seed(store, 'where_has', [
        { id: 'h1', tags: ['a', 'b'], nums: [1, 2] },
        { id: 'h2', tags: ['b'], nums: [] },
        { id: 'h3', tags: [], nums: null },
        { id: 'h4', tags: null },
        { id: 'h5' },
      ]);
      const expectations: readonly (readonly [AnyWhere, readonly string[]])[] =
        [
          [{ tags: { has: 'a' } }, ['h1']],
          [{ tags: { has: 'b' } }, ['h1', 'h2']],
          [{ tags: { has: 'z' } }, []],
          [{ nums: { has: 2 } }, ['h1']],
          [{ nums: { has: 3 } }, []],
          [{ or: [{ tags: { has: 'a' } }, { nums: { has: 9 } }] }, ['h1']],
          [{ tags: { nhas: 'a' } }, ['h2', 'h3', 'h4', 'h5']],
          [{ tags: { nhas: 'b' } }, ['h3', 'h4', 'h5']],
          [{ nums: { nhas: 2 } }, ['h2', 'h3', 'h4', 'h5']],
          [{ tags: { has: 'b', nhas: 'a' } }, ['h2']],
          [{ tags: { has: 'a', nhas: 'a' } }, []],
          [{ tags: { nhas: 'a', exists: false } }, ['h4', 'h5']],
          [
            { or: [{ tags: { nhas: 'b' } }, { nums: { has: 1 } }] },
            ['h1', 'h3', 'h4', 'h5'],
          ],
          // `nhas` and `exists: true` are both `$ne` in Mongo.
          [{ tags: { nhas: 'a', exists: true } }, ['h2', 'h3']],
        ];
      for (const [where, ids] of expectations) {
        same(
          await found(store, 'where_has', where),
          ids,
          `find with ${show(where)}`,
        );
      }
      same(
        await store.count('where_has', { tags: { has: 'b' } }),
        2,
        'count with has',
      );
      same(
        await store.count('where_has', { tags: { nhas: 'a' } }),
        4,
        'count with nhas',
      );
    },
  },
  whereCase('exists: null does not exist; arrays and objects', [
    [{ note: { exists: true } }, ['t1', 't4']],
    [{ note: { exists: false } }, ['t2', 't3']],
    [{ tags: { exists: true } }, ['t1', 't2']],
    [{ meta: { exists: true } }, ['t1']],
    [{ meta: { exists: false } }, ['t2', 't3', 't4']],
  ]),
  whereCase('contains is case-insensitive and literal, never a regex', [
    [{ name: { contains: 'ALPHA' } }, ['t1']],
    [{ name: { contains: '.' } }, ['t3']],
    [{ name: { contains: '*' } }, ['t3']],
    [{ name: { contains: '(a.b*)' } }, ['t3']],
    [{ name: { contains: '\\' } }, ['t4']],
    [{ note: { contains: 'x' } }, ['t1']],
  ]),
  whereCase('several operators, or several fields, all have to match', [
    [{ n: { gt: 1, lt: 10 } }, ['t2', 't3']],
    [{ flag: { eq: true }, n: { gt: 1 } }, ['t4']],
  ]),
  whereCase('and, or and nesting', [
    [{ or: [{ n: { eq: 1 } }, { name: { eq: 'beta' } }] }, ['t1', 't2']],
    [
      {
        and: [
          { or: [{ n: { eq: 1 } }, { n: { eq: 10 } }] },
          { flag: { eq: true } },
        ],
      },
      ['t1', 't4'],
    ],
    [
      {
        or: [
          { and: [{ n: { gte: 3 } }, { flag: { exists: false } }] },
          { note: { eq: 'x' } },
        ],
      },
      ['t1', 't3'],
    ],
    [
      { n: { gt: 1 }, or: [{ note: { eq: null } }, { note: { eq: 'y' } }] },
      ['t2', 't3', 't4'],
    ],
  ]),

  // ---------------------------------------------------------------- copies
  {
    name: 'stores copies: mutating an argument or a returned doc changes nothing',
    async run(store) {
      const original = post('p1', { meta: { tags: ['a'] } });
      const arg: { id: string; [field: string]: unknown } =
        structuredClone(original);
      await store.insert('c_copies', arg);
      arg.meta = 'changed';

      const got = await store.get('c_copies', 'p1');
      Object.assign(got ?? {}, { title: 'changed' });
      const [many] = await store.getMany('c_copies', ['p1']);
      Object.assign(many ?? {}, { title: 'changed' });
      const [first] = (
        await store.find({
          collection: 'c_copies',
          sort: [],
          optional: [],
          limit: 1,
        })
      ).docs;
      Object.assign(first ?? {}, { title: 'changed' });
      const patch = { meta: { tags: ['b'] } };
      const updated = await store.update('c_copies', 'p1', patch);
      patch.meta.tags.push('mutated');
      Object.assign(updated ?? {}, { title: 'changed' });

      same(
        await store.get('c_copies', 'p1'),
        post('p1', { meta: { tags: ['b'] } }),
        'the stored doc after every mutation',
      );
    },
  },
  {
    name: 'remove returns the stored doc, not the inserted argument',
    async run(store) {
      const arg: { id: string; [field: string]: unknown } = post('p1');
      await store.insert('c_remove', arg);
      arg.title = 'changed';
      same(await store.remove('c_remove', 'p1'), post('p1'), 'the removed doc');
    },
  },

  // ---------------------------------------------------------------- cursors
  {
    name: 'pages every sort with ties: each doc once, in order',
    async run(store) {
      await seed(store, 'k_sorts', tied);
      for (const sort of sorts) {
        for (const limit of [1, 2, 5, 12, 20]) {
          checkPages(
            await pages(store, 'k_sorts', sort, limit),
            expectedOrder(tied, sort),
            limit,
            `sort ${show(sort)}, limit ${limit}`,
          );
        }
      }
    },
  },
  {
    name: 'next is null on the last page, even when it is full',
    async run(store) {
      await seed(store, 'k_full', tied);
      same(
        (await pages(store, 'k_full', ['a'], 4)).map((page) => page.length),
        [4, 4, 4],
        'page sizes',
      );
    },
  },
  {
    name: 'pages under a where with ties',
    async run(store) {
      await seed(store, 'k_where', tied);
      const keep = { keep: { eq: true } };
      const kept = tied.filter((doc) => doc.keep === true);
      for (const sort of [['a'], ['-a', 'b'], ['b', '-a']]) {
        checkPages(
          await pages(store, 'k_where', sort, 2, keep),
          expectedOrder(kept, sort),
          2,
          `sort ${show(sort)} under keep`,
        );
      }
    },
  },
  {
    name: 'pages under an or: the keyset ANDs with the caller’s or',
    async run(store) {
      await seed(store, 'k_or', tied);
      const where = { or: [{ a: { eq: 0 } }, { b: { eq: 'y' } }] };
      const matching = tied.filter((doc) => doc.a === 0 || doc.b === 'y');
      checkPages(
        await pages(store, 'k_or', ['-a', 'b'], 3, where),
        expectedOrder(matching, ['-a', 'b']),
        3,
        'sort -a, b under the or',
      );
    },
  },
  {
    name: 'a doc inserted after page one appears by its sort position',
    async run(store) {
      await seed(store, 'k_insert', tied);
      const first = await store.find({
        collection: 'k_insert',
        sort: ['a'],
        optional: [],
        limit: 4,
      });
      same(idsOf(first.docs), ['d00', 'd03', 'd06', 'd09'], 'page one');
      // Before the cursor (a 0, id d09): never seen. After it: seen in place.
      await store.insert('k_insert', { id: 'd01x', a: 0, b: 'x', keep: true });
      await store.insert('k_insert', { id: 'd99', a: 2, b: 'x', keep: true });
      const rest: string[] = [];
      let after = first.next;
      while (after !== null) {
        const page = await store.find({
          collection: 'k_insert',
          sort: ['a'],
          optional: [],
          limit: 4,
          after,
        });
        rest.push(...idsOf(page.docs));
        after = page.next;
      }
      same(
        rest,
        ['d01', 'd04', 'd07', 'd10', 'd02', 'd05', 'd08', 'd11', 'd99'],
        'the later pages',
      );
    },
  },
  {
    name: 'a cursor from another sort, or a malformed one, is VALIDATION on after',
    async run(store) {
      await seed(store, 'k_bad', tied);
      const first = await store.find({
        collection: 'k_bad',
        sort: ['a'],
        optional: [],
        limit: 2,
      });
      const next = first.next ?? '';
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const bad: readonly (readonly [readonly string[], string])[] = [
        [['-a'], next],
        [['a', 'b'], next],
        [['a'], 'not a cursor'],
        [['a'], encode({ sort: ['a', 'id'] })],
        [['a'], encode({ sort: ['a', 'id'], values: [1] })],
        [['a'], encode({ sort: ['a', 'id'], values: [1, {}] })],
      ];
      for (const [sort, after] of bad) {
        const error = await rejection(
          store.find({
            collection: 'k_bad',
            sort,
            optional: [],
            limit: 2,
            after,
          }),
          `find with sort ${show(sort)} and cursor ${after}`,
        );
        same(
          LatticeError.is(error) && error.code === 'VALIDATION'
            ? error.data.issues.map((issue) => issue.path)
            : error,
          [['after']],
          `the error for sort ${show(sort)} and cursor ${after}`,
        );
      }
      same(
        (
          await store.find({
            collection: 'k_bad',
            sort: ['a'],
            optional: [],
            limit: 2,
            after: next,
          })
        ).docs.length,
        2,
        'the good cursor still pages',
      );
    },
  },

  {
    name: 'an optional field sorts with missing and null values last, in either direction, paging across the boundary',
    async run(store) {
      await seed(store, 'o_dated', dated);
      for (const sort of optionalSorts) {
        const expected = expectedMissingLast(dated, sort);
        for (const limit of [1, 2, 3, 4, 10]) {
          checkPages(
            await pages(
              store,
              'o_dated',
              sort,
              limit,
              undefined,
              datedOptional,
            ),
            expected,
            limit,
            `sort ${show(sort)} by ${limit}`,
          );
        }
      }
    },
  },
  {
    name: 'an optional sort pages under a where, and the where on the field is unchanged',
    async run(store) {
      await seed(store, 'o_where', dated);
      const ranked = dated.filter((doc) => doc.rank === 2);
      // One sort per plan, under a where.
      for (const sort of [['-due'], ['due', '-note'], ['due', 'note']]) {
        checkPages(
          await pages(
            store,
            'o_where',
            sort,
            2,
            { rank: { eq: 2 } },
            datedOptional,
          ),
          expectedMissingLast(ranked, sort),
          2,
          `sort ${show(sort)} under rank 2`,
        );
      }
      same(
        await found(store, 'o_where', { due: { exists: false } }),
        ['e01', 'e03', 'e05', 'e08', 'e09', 'e10'],
        'the rows without a due date',
      );
    },
  },
  {
    name: 'a cursor with no value for a required key is VALIDATION on after',
    async run(store) {
      await seed(store, 'o_bad', dated);
      const encode = (value: unknown) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const error = await rejection(
        store.find({
          collection: 'o_bad',
          sort: ['rank'],
          optional: [],
          limit: 2,
          after: encode({ sort: ['rank', 'id'], values: [null, 'e00'] }),
        }),
        'find after a null on a required key',
      );
      same(
        LatticeError.is(error) && error.code === 'VALIDATION'
          ? error.data.issues.map((issue) => issue.path)
          : error,
        [['after']],
        'the error',
      );
    },
  },

  // ---------------------------------------------------------------- transaction
  {
    name: 'transaction commits its writes, returns its value, and reads them inside',
    async run(store) {
      await seed(store, 'x_commit', [post('p1'), post('p2')]);
      const result = await store.transaction(async (tx) => {
        await tx.insert('x_commit', post('p3'));
        await tx.update('x_commit', 'p1', { title: 'changed' });
        await tx.remove('x_commit', 'p2');
        same(
          await tx.get('x_commit', 'p3'),
          post('p3'),
          'p3 read inside the work',
        );
        same(await tx.count('x_commit'), 2, 'count inside the work');
        return 'done';
      });
      same(result, 'done', 'the value of the work');
      same(
        idsOf(
          (
            await store.find({
              collection: 'x_commit',
              sort: ['id'],
              optional: [],
              limit: 10,
            })
          ).docs,
        ),
        ['p1', 'p3'],
        'ids after the commit',
      );
      same(
        await store.get('x_commit', 'p1'),
        post('p1', { title: 'changed' }),
        'p1 after the commit',
      );
    },
  },
  {
    name: 'transaction rolls back every write when the work throws, and the error passes through',
    needs: ['transactions'],
    async run(store) {
      await seed(store, 'x_rollback', [post('p1'), post('p2')]);
      const failure = new Error('rolled back');
      const error = await rejection(
        store.transaction(async (tx) => {
          await tx.insert('x_rollback', post('p3'));
          await tx.update('x_rollback', 'p1', { title: 'changed' });
          await tx.remove('x_rollback', 'p2');
          same(
            await tx.get('x_rollback', 'p3'),
            post('p3'),
            'p3 read inside the work',
          );
          throw failure;
        }),
        'a throwing transaction',
      );
      same(error === failure, true, 'the work’s own error');
      same(
        (
          await store.find({
            collection: 'x_rollback',
            sort: ['id'],
            optional: [],
            limit: 10,
          })
        ).docs,
        [post('p1'), post('p2')],
        'the documents after the rollback',
      );
    },
  },
  {
    name: 'a nested transaction joins the outer one, and a throw rolls back both',
    needs: ['transactions'],
    async run(store) {
      await seed(store, 'x_nested', [post('p1')]);
      await rejection(
        store.transaction(async (tx) => {
          await tx.transaction(async (inner) => {
            await inner.insert('x_nested', post('p2'));
          });
          same(
            await tx.get('x_nested', 'p2'),
            post('p2'),
            'the inner write, inside',
          );
          throw new Error('outer failed');
        }),
        'an outer throw after an inner transaction',
      );
      same(await store.get('x_nested', 'p2'), null, 'p2 after the rollback');
    },
  },
  {
    name: 'a transaction that starts while another runs does not join it, so the first one’s rollback keeps its writes',
    needs: ['transactions'],
    async run(store) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = store.transaction(async (tx) => {
        await tx.insert('x_concurrent', post('p1'));
        await gate;
        throw new Error('first failed');
      });
      const second = store.transaction(async (tx) => {
        same(
          await tx.get('x_concurrent', 'p1'),
          null,
          'the first one’s write, unseen by the second',
        );
        await tx.insert('x_concurrent', post('p2'));
      });
      release();
      await rejection(first, 'the first transaction');
      await second;
      same(await store.get('x_concurrent', 'p1'), null, 'p1, rolled back');
      same(await store.get('x_concurrent', 'p2'), post('p2'), 'p2, committed');
    },
  },
  {
    name: 'a write outside a transaction is kept when the transaction rolls back',
    needs: ['transactions'],
    async run(store) {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      let started = () => {};
      const running = new Promise<void>((resolve) => {
        started = resolve;
      });
      const failing = store.transaction(async (tx) => {
        await tx.insert('x_outside', post('p1'));
        started();
        await gate;
        throw new Error('failed');
      });
      await running;
      await store.insert('x_outside', post('p2'));
      release();
      await rejection(failing, 'the transaction');
      same(await store.get('x_outside', 'p1'), null, 'p1, rolled back');
      same(await store.get('x_outside', 'p2'), post('p2'), 'p2, kept');
    },
  },
  {
    name: 'a call on the root store from inside work does not join, so a rollback keeps it',
    needs: ['transactions'],
    async run(store) {
      await rejection(
        store.transaction(async (tx) => {
          await tx.insert('x_root', post('p1'));
          await store.insert('x_root', post('p2'));
          throw new Error('failed');
        }),
        'the transaction',
      );
      same(await store.get('x_root', 'p1'), null, 'p1, rolled back');
      same(await store.get('x_root', 'p2'), post('p2'), 'p2, kept');
    },
  },
  {
    name: 'a transaction on the root store from inside work is a separate one, and commits on its own',
    needs: ['transactions'],
    async run(store) {
      await rejection(
        store.transaction(async (tx) => {
          await tx.insert('x_separate', post('p1'));
          await store.transaction(async (other) => {
            await other.insert('x_separate', post('p2'));
          });
          throw new Error('failed');
        }),
        'the outer transaction',
      );
      same(await store.get('x_separate', 'p1'), null, 'p1, rolled back');
      same(await store.get('x_separate', 'p2'), post('p2'), 'p2, committed');
    },
  },

  // ---------------------------------------------------------------- count
  {
    name: 'count on an empty or unknown collection is 0',
    async run(store) {
      same(await store.count('n_none'), 0, 'count of an unknown collection');
      same(await store.count('n_none', drafts), 0, 'count with where');
    },
  },
  {
    name: 'count counts every doc, or those in where, as find does',
    async run(store) {
      await seed(store, 'n_count', things);
      same(await store.count('n_count'), 4, 'count of every doc');
      const filters: readonly AnyWhere[] = [
        { note: { eq: null } },
        { n: { gt: 1, lt: 10 } },
        { or: [{ flag: { eq: true } }, { tags: { exists: true } }] },
        { name: { eq: 'none' } },
      ];
      for (const where of filters) {
        same(
          await store.count('n_count', where),
          (await found(store, 'n_count', where)).length,
          `count with ${show(where)}`,
        );
      }
    },
  },

  // ---------------------------------------------------------------- countBy
  {
    name: 'countBy on an empty or unknown collection has no groups',
    async run(store) {
      same(
        await store.countBy({
          collection: 'g_none',
          field: 'status',
          limit: 10,
        }),
        { groups: [], more: false },
        'countBy of an unknown collection',
      );
    },
  },
  {
    name: 'countBy counts by value, most first, then by key with null first',
    async run(store) {
      await seed(store, 'g_scalar', [
        post('p1', { status: 'open', n: 2, flag: true }),
        post('p2', { status: 'open', n: 1, flag: false }),
        post('p3', { status: 'closed', n: 2, flag: true }),
        post('p4', { status: null, n: 1 }),
        { id: 'p5', title: 'Post p5', n: 3, flag: false },
        post('p6', { status: 'draft', n: 3, flag: true }),
      ]);
      const by = (field: string, where?: AnyWhere) =>
        store.countBy({
          collection: 'g_scalar',
          field,
          limit: 10,
          ...(where === undefined ? {} : { where }),
        });
      same(
        await by('status'),
        {
          groups: [
            { key: null, count: 2 },
            { key: 'open', count: 2 },
            { key: 'closed', count: 1 },
            { key: 'draft', count: 1 },
          ],
          more: false,
        },
        'countBy a string, with a missing and a null value',
      );
      same(
        (await by('n')).groups,
        [
          { key: 1, count: 2 },
          { key: 2, count: 2 },
          { key: 3, count: 2 },
        ],
        'countBy a number',
      );
      same(
        (await by('flag')).groups,
        [
          { key: true, count: 3 },
          { key: false, count: 2 },
          { key: null, count: 1 },
        ],
        'countBy a boolean',
      );
      same(
        (await by('status', { n: { gt: 1 } })).groups,
        [
          { key: null, count: 1 },
          { key: 'closed', count: 1 },
          { key: 'draft', count: 1 },
          { key: 'open', count: 1 },
        ],
        'countBy with where',
      );
    },
  },
  {
    name: 'countBy an array counts each distinct element once per document',
    async run(store) {
      await seed(store, 'g_array', [
        post('p1', { tags: ['a', 'b', 'a'] }),
        post('p2', { tags: ['b'] }),
        post('p3', { tags: [] }),
        post('p4', { tags: [null, 'c'] }),
        post('p5'),
      ]);
      same(
        await store.countBy({
          collection: 'g_array',
          field: 'tags',
          limit: 10,
        }),
        {
          groups: [
            { key: null, count: 3 },
            { key: 'b', count: 2 },
            { key: 'a', count: 1 },
            { key: 'c', count: 1 },
          ],
          more: false,
        },
        'countBy an array field',
      );
    },
  },
  {
    name: 'countBy cuts at limit and says there are more',
    async run(store) {
      await seed(store, 'g_limit', [
        post('p1', { status: 'a' }),
        post('p2', { status: 'b' }),
        post('p3', { status: 'b' }),
        post('p4', { status: 'c' }),
      ]);
      const at = (limit: number) =>
        store.countBy({ collection: 'g_limit', field: 'status', limit });
      same(
        await at(2),
        {
          groups: [
            { key: 'b', count: 2 },
            { key: 'a', count: 1 },
          ],
          more: true,
        },
        'countBy past its limit',
      );
      same((await at(3)).more, false, 'countBy at exactly its limit');
    },
  },

  // ---------------------------------------------------------------- ensure
  {
    name: 'ensure is idempotent and never drops an index',
    async run(store) {
      const unique: Index = { fields: { email: 1 }, unique: true };
      await store.ensure('e_keep', [unique]);
      await store.ensure('e_keep', [unique]);
      await store.ensure('e_keep', []);
      await store.insert('e_keep', { id: 'u1', email: 'a@x' });
      await conflict(
        store.insert('e_keep', { id: 'u2', email: 'a@x' }),
        'e_keep',
        'u2',
        ['email'],
        'a duplicate after ensure([])',
      );
    },
  },
  {
    name: 'a unique index: a duplicate insert or update is CONFLICT, and nothing is stored',
    async run(store) {
      await store.ensure('e_unique', [{ fields: { email: 1 }, unique: true }]);
      await seed(store, 'e_unique', [
        { id: 'u1', email: 'a@x' },
        { id: 'u2', email: 'b@x' },
      ]);
      await conflict(
        store.insert('e_unique', { id: 'u3', email: 'a@x' }),
        'e_unique',
        'u3',
        ['email'],
        'insert a duplicate email',
      );
      same(await store.get('e_unique', 'u3'), null, 'u3 after the conflict');
      await conflict(
        store.update('e_unique', 'u2', { email: 'a@x' }),
        'e_unique',
        'u2',
        ['email'],
        'update to a duplicate email',
      );
      same(
        await store.get('e_unique', 'u2'),
        { id: 'u2', email: 'b@x' },
        'u2 after the conflict',
      );
      same(
        await store.update('e_unique', 'u1', { email: 'a@x', name: 'kept' }),
        { id: 'u1', email: 'a@x', name: 'kept' },
        'update that keeps its own value',
      );
    },
  },
  {
    name: 'a compound unique index conflicts on the whole tuple only',
    async run(store) {
      await store.ensure('e_compound', [
        { fields: { org: 1, email: 1 }, unique: true },
      ]);
      await seed(store, 'e_compound', [
        { id: 'u1', org: 'o1', email: 'a@x' },
        { id: 'u2', org: 'o2', email: 'a@x' },
      ]);
      await conflict(
        store.insert('e_compound', { id: 'u3', org: 'o1', email: 'a@x' }),
        'e_compound',
        'u3',
        ['org', 'email'],
        'insert the same org and email',
      );
    },
  },
  {
    name: 'a unique index treats a missing field as null',
    async run(store) {
      await store.ensure('e_missing', [{ fields: { email: 1 }, unique: true }]);
      await store.insert('e_missing', { id: 'u1' });
      await conflict(
        store.insert('e_missing', { id: 'u2' }),
        'e_missing',
        'u2',
        ['email'],
        'a second doc missing email',
      );
      await conflict(
        store.insert('e_missing', { id: 'u3', email: null }),
        'e_missing',
        'u3',
        ['email'],
        'a null email beside a missing one',
      );
    },
  },
  {
    name: 'a unique index over an array keys each element, so two docs that share one conflict',
    async run(store) {
      await store.ensure('e_multikey', [{ fields: { tags: 1 }, unique: true }]);
      await seed(store, 'e_multikey', [
        { id: 'u1', tags: ['a', 'b'] },
        { id: 'u2', tags: ['c'] },
        { id: 'u3', tags: ['d', 'd'] },
      ]);
      await conflict(
        store.insert('e_multikey', { id: 'u4', tags: ['b', 'e'] }),
        'e_multikey',
        'u4',
        ['tags'],
        'insert a doc that shares b',
      );
      await conflict(
        store.insert('e_multikey', { id: 'u4', tags: 'a' }),
        'e_multikey',
        'u4',
        ['tags'],
        'insert a scalar equal to an element',
      );
      await conflict(
        store.update('e_multikey', 'u2', { tags: ['c', 'a'] }),
        'e_multikey',
        'u2',
        ['tags'],
        'update to share a',
      );
      same(
        await store.update('e_multikey', 'u1', { tags: ['b', 'a', 'f'] }),
        { id: 'u1', tags: ['b', 'a', 'f'] },
        'update that keeps its own elements',
      );
    },
  },
  {
    name: 'a unique index keys an empty array apart from a missing field',
    async run(store) {
      await store.ensure('e_empty', [{ fields: { tags: 1 }, unique: true }]);
      await seed(store, 'e_empty', [{ id: 'u1', tags: [] }, { id: 'u2' }]);
      await conflict(
        store.insert('e_empty', { id: 'u3', tags: [] }),
        'e_empty',
        'u3',
        ['tags'],
        'a second empty array',
      );
    },
  },
  {
    name: 'a unique index keys a null element as null, so it clashes with a missing field',
    async run(store) {
      await store.ensure('e_null_element', [
        { fields: { tags: 1 }, unique: true },
      ]);
      await seed(store, 'e_null_element', [{ id: 'u1' }]);
      await conflict(
        store.insert('e_null_element', { id: 'u2', tags: [null] }),
        'e_null_element',
        'u2',
        ['tags'],
        'an array holding null',
      );
    },
  },
  {
    name: 'an index refuses a document with two array fields, empty or not',
    async run(store) {
      await store.ensure('e_parallel', [{ fields: { a: 1, b: 1 } }]);
      await seed(store, 'e_parallel', [{ id: 'u1', a: [1], b: 2 }]);
      for (const doc of [
        { id: 'u2', a: [1], b: [2] },
        { id: 'u2', a: [], b: [] },
      ]) {
        const error = await rejection(
          store.insert('e_parallel', doc),
          `insert ${show(doc)}`,
        );
        assert.match(String(error), /parallel arrays/);
      }
      const error = await rejection(
        store.update('e_parallel', 'u1', { b: [2] }),
        'an update to two arrays',
      );
      assert.match(String(error), /parallel arrays/);
      same(
        await store.get('e_parallel', 'u1'),
        { id: 'u1', a: [1], b: 2 },
        'u1, unchanged',
      );
      same(await store.get('e_parallel', 'u2'), null, 'u2, not stored');
    },
  },
  {
    name: 'a compound unique index over an array keys each element with the other fields',
    async run(store) {
      await store.ensure('e_compound_multikey', [
        { fields: { org: 1, tags: 1 }, unique: true },
      ]);
      await seed(store, 'e_compound_multikey', [
        { id: 'u1', org: 'o1', tags: ['a', 'b'] },
        { id: 'u2', org: 'o2', tags: ['a'] },
      ]);
      await conflict(
        store.insert('e_compound_multikey', {
          id: 'u3',
          org: 'o1',
          tags: ['b'],
        }),
        'e_compound_multikey',
        'u3',
        ['org', 'tags'],
        'insert o1 with b',
      );
    },
  },
  {
    name: 'ensuring a unique index over duplicates rejects',
    async run(store) {
      await seed(store, 'e_dupes', [
        { id: 'u1', email: 'a@x' },
        { id: 'u2', email: 'a@x' },
      ]);
      await rejection(
        store.ensure('e_dupes', [{ fields: { email: 1 }, unique: true }]),
        'ensure a unique index over two a@x',
      );
      await seed(store, 'e_dupes_multikey', [
        { id: 'u1', tags: ['a', 'b'] },
        { id: 'u2', tags: ['b'] },
      ]);
      await rejection(
        store.ensure('e_dupes_multikey', [
          { fields: { tags: 1 }, unique: true },
        ]),
        'ensure a unique index over two docs that share b',
      );
    },
  },
  {
    name: 'ensuring the same keys with other options rejects, and keeps the first',
    async run(store) {
      await store.ensure('e_options', [{ fields: { email: 1 } }]);
      await rejection(
        store.ensure('e_options', [{ fields: { email: 1 }, unique: true }]),
        'ensure a unique index on keys a non-unique index has',
      );
      await seed(store, 'e_options', [
        { id: 'u1', email: 'a@x' },
        { id: 'u2', email: 'a@x' },
      ]);
      same(
        await store.count('e_options', { email: { eq: 'a@x' } }),
        2,
        'duplicates under the first, non-unique index',
      );
      await store.ensure('e_options_unique', [
        { fields: { email: 1 }, unique: true },
      ]);
      await rejection(
        store.ensure('e_options_unique', [{ fields: { email: 1 } }]),
        'ensure a non-unique index on keys a unique index has',
      );
    },
  },
  {
    name: 'a unique index with present skips rows without a value',
    async run(store) {
      await store.ensure('e_present', [
        { fields: { org: 1, emails: 1 }, unique: true, present: ['emails'] },
      ]);
      const without = [
        { org: 'o1' },
        { org: 'o1', emails: null },
        { org: 'o1', emails: [] },
        { org: 'o1', emails: [null] },
        { org: 'o1', emails: [['a']] },
      ];
      await seed(
        store,
        'e_present',
        [...without, ...without].map((doc, at) => ({ id: `n${at}`, ...doc })),
      );
      await seed(store, 'e_present', [
        { id: 'u1', org: 'o1', emails: ['a', 'b'] },
        { id: 'u2', org: 'o2', emails: ['a'] },
        { id: 'u3', org: 'o1', emails: [null, 'c'] },
      ]);
      await conflict(
        store.insert('e_present', { id: 'u4', org: 'o1', emails: ['b'] }),
        'e_present',
        'u4',
        ['org', 'emails'],
        'insert o1 with b',
      );
      await conflict(
        store.insert('e_present', { id: 'u4', org: 'o1', emails: ['c'] }),
        'e_present',
        'u4',
        ['org', 'emails'],
        'insert o1 with c, beside a null',
      );
    },
  },
  {
    name: 'a unique index with present applies to a scalar field',
    async run(store) {
      await store.ensure('e_present_scalar', [
        { fields: { externalId: 1 }, unique: true, present: ['externalId'] },
      ]);
      await seed(store, 'e_present_scalar', [
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u3', externalId: null },
        { id: 'u4', externalId: null },
        { id: 'u5', externalId: 'x1' },
        { id: 'u6', externalId: 0 },
        { id: 'u7', externalId: false },
      ]);
      for (const externalId of ['x1', 0, false]) {
        await conflict(
          store.insert('e_present_scalar', { id: 'u8', externalId }),
          'e_present_scalar',
          'u8',
          ['externalId'],
          `insert ${show(externalId)}`,
        );
      }
    },
  },
  {
    name: 'an update moves a row into and out of a unique index with present',
    async run(store) {
      await store.ensure('e_present_update', [
        { fields: { emails: 1 }, unique: true, present: ['emails'] },
      ]);
      await seed(store, 'e_present_update', [
        { id: 'u1', emails: ['a'] },
        { id: 'u2', emails: [] },
      ]);
      await conflict(
        store.update('e_present_update', 'u2', { emails: ['a'] }),
        'e_present_update',
        'u2',
        ['emails'],
        'update u2 into the index with a',
      );
      await store.update('e_present_update', 'u1', { emails: undefined });
      same(
        await store.update('e_present_update', 'u2', { emails: ['a'] }),
        { id: 'u2', emails: ['a'] },
        'update u2 to a once u1 left the index',
      );
    },
  },
  {
    name: 'a unique index with present needs every listed field',
    async run(store) {
      await store.ensure('e_present_both', [
        { fields: { a: 1, b: 1 }, unique: true, present: ['a', 'b'] },
      ]);
      await seed(store, 'e_present_both', [
        { id: 'u1', a: 'x' },
        { id: 'u2', a: 'x' },
        { id: 'u3', a: 'x', b: 'y' },
      ]);
      await conflict(
        store.insert('e_present_both', { id: 'u4', a: 'x', b: 'y' }),
        'e_present_both',
        'u4',
        ['a', 'b'],
        'insert x, y',
      );
    },
  },
  {
    name: 'a row that present leaves out is not checked for parallel arrays',
    async run(store) {
      await store.ensure('e_present_parallel', [
        { fields: { a: 1, b: 1 }, unique: true, present: ['a'] },
      ]);
      await seed(store, 'e_present_parallel', [
        { id: 'u1', a: [], b: [1] },
        { id: 'u2', a: [null], b: [1] },
      ]);
      const error = await rejection(
        store.insert('e_present_parallel', { id: 'u3', a: [1], b: [1] }),
        'insert a covered row with two arrays',
      );
      assert.match(String(error), /parallel arrays/);
    },
  },
  {
    name: 'ensuring a unique index with present skips rows without a value',
    async run(store) {
      await seed(store, 'e_present_dupes', [
        { id: 'u1' },
        { id: 'u2' },
        { id: 'u3', email: null },
      ]);
      await store.ensure('e_present_dupes', [
        { fields: { email: 1 }, unique: true, present: ['email'] },
      ]);
      await seed(store, 'e_present_dupes_values', [
        { id: 'u1', email: 'a@x' },
        { id: 'u2', email: 'a@x' },
      ]);
      await rejection(
        store.ensure('e_present_dupes_values', [
          { fields: { email: 1 }, unique: true, present: ['email'] },
        ]),
        'ensure over two a@x',
      );
    },
  },
  {
    name: 'ensuring the same keys with other present rejects, in any order',
    async run(store) {
      const keys = { a: 1, b: 1 } as const;
      await store.ensure('e_present_options', [
        { fields: keys, unique: true, present: ['a', 'b'] },
      ]);
      await store.ensure('e_present_options', [
        { fields: keys, unique: true, present: ['b', 'a'] },
      ]);
      for (const index of [
        { fields: keys, unique: true, present: ['b'] },
        { fields: keys, unique: true },
      ]) {
        await rejection(
          store.ensure('e_present_options', [index]),
          `ensure ${show(index)}`,
        );
      }
    },
  },
  {
    name: 'a non-unique index changes no results',
    async run(store) {
      await store.ensure('e_plain', [{ fields: { a: 1, b: -1 } }]);
      await seed(store, 'e_plain', tied);
      same(
        (await pages(store, 'e_plain', ['a', 'b'], 5)).flat(),
        expectedOrder(tied, ['a', 'b']),
        'find under the index',
      );
      same(
        await store.count('e_plain', { a: { eq: 1 } }),
        4,
        'count under the index',
      );
    },
  },
];
