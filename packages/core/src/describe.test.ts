import { type CatalogProcedure, catalog } from '@ts-pf/docs';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArchivePost } from './fixtures/archive-post.js';
import { AppUseCase, allowAll } from './fixtures/context.js';
import { Posts } from './fixtures/posts.js';
import { PublishPost } from './fixtures/publish-post.js';
import { collection, framework, many, ref } from './index.js';

const Deals = collection('deals', {
  schema: z.object({
    title: z.string(),
    amount: z.number(),
    note: z.string().optional(),
  }),
  maskable: ['amount', 'note'],
});
const Tasks = collection('tasks', {
  schema: z.object({ title: z.string(), dealId: ref('deals') }),
});
const Boards = collection('boards', {
  schema: z.object({ name: z.string() }),
  relations: { posts: many('posts', { through: 'board_posts' }) },
});

const contract = framework({ family: AppUseCase })
  .collection(Posts, {
    access: { ...allowAll, publish: () => true },
    overrides: { delete: ArchivePost },
    methods: { publish: PublishPost },
  })
  .collection(Deals, {
    access: allowAll,
    fields: { amount: { read: () => true }, note: { read: () => true } },
  })
  .collection(Tasks, { access: allowAll })
  .collection(Boards, { access: allowAll }).contract;

const procedures = catalog(contract, { prefix: '/rpc' }).procedures;

function procedureAt(key: string): CatalogProcedure {
  const found = procedures.find((procedure) => procedure.key === key);
  if (found === undefined) throw new Error(`no ${key}`);
  return found;
}

/** The JSON Schema of a procedure's input. */
function inputOf(key: string): Record<string, unknown> {
  const { input } = procedureAt(key);
  if (input?.kind !== 'json') throw new Error(`${key} has no JSON input`);
  return input.jsonSchema;
}

/** The value at `path` in `value`, through objects only. */
function at(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = Object.entries(current).find(([name]) => name === key)?.[1];
  }
  return current;
}

describe('generated procedures', () => {
  it('carry a summary and an MCP effect per operation', () => {
    expect(
      Object.fromEntries(
        procedures.map((procedure) => [
          procedure.key,
          [at(procedure.meta, ['mcp', 'effect']), procedure.docs?.summary],
        ]),
      ),
    ).toEqual({
      'posts/find': [
        'read',
        'Find posts. Filter with where, order with sort, and page with limit and after (the previous page’s next).',
      ],
      'posts/count': ['read', 'Count posts. Filter with where.'],
      'posts/get': ['read', 'Get one posts document by id.'],
      'posts/create': ['write', 'Create a posts document.'],
      'posts/update': [
        'write',
        'Update a posts document by id. Send only the fields to change.',
      ],
      // An override keeps the generated node, and its meta.
      'posts/delete': ['destructive', 'Delete a posts document by id.'],
      // A method gets none: the app describes it.
      'posts/publish': [undefined, undefined],
      'deals/find': [
        'read',
        'Find deals. Filter with where, order with sort, and page with limit and after (the previous page’s next).',
      ],
      'deals/count': ['read', 'Count deals. Filter with where.'],
      'deals/get': ['read', 'Get one deals document by id.'],
      'deals/create': ['write', 'Create a deals document.'],
      'deals/update': [
        'write',
        'Update a deals document by id. Send only the fields to change.',
      ],
      'deals/delete': ['destructive', 'Delete a deals document by id.'],
      'tasks/find': [
        'read',
        'Find tasks. Filter with where, order with sort, and page with limit and after (the previous page’s next). populate expands dealId into documents.',
      ],
      'tasks/count': ['read', 'Count tasks. Filter with where.'],
      'tasks/get': [
        'read',
        'Get one tasks document by id. populate expands dealId into documents.',
      ],
      'tasks/create': ['write', 'Create a tasks document.'],
      'tasks/update': [
        'write',
        'Update a tasks document by id. Send only the fields to change.',
      ],
      'tasks/delete': ['destructive', 'Delete a tasks document by id.'],
      'boards/find': [
        'read',
        'Find boards. Filter with where, order with sort, and page with limit and after (the previous page’s next).',
      ],
      'boards/count': ['read', 'Count boards. Filter with where.'],
      'boards/get': [
        'read',
        'Get one boards document by id. populate expands posts into documents.',
      ],
      'boards/create': ['write', 'Create a boards document.'],
      'boards/update': [
        'write',
        'Update a boards document by id. Send only the fields to change.',
      ],
      'boards/delete': ['destructive', 'Delete a boards document by id.'],
      'boards/posts/list': [
        'read',
        'List the posts links of one boards document, by its id. Filter with where, order with sort, and page with limit and after (the previous page’s next). populate expands boardsId, postsId into documents.',
      ],
      'boards/posts/set': [
        'destructive',
        'Replace the posts links of one boards document, by its id. Links not given are removed.',
      ],
    });
  });

  it('state the effect in their types, so a toolkit filters as the server does', () => {
    expectTypeOf<
      (typeof contract)['deals']['find']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'read'>();
    expectTypeOf<
      (typeof contract)['tasks']['get']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'read'>();
    expectTypeOf<
      (typeof contract)['deals']['update']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'write'>();
    expectTypeOf<
      (typeof contract)['posts']['delete']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'destructive'>();
    expectTypeOf<
      (typeof contract)['boards']['posts']['list']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'read'>();
    expectTypeOf<
      (typeof contract)['boards']['posts']['set']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'destructive'>();
    expectTypeOf<
      (typeof contract)['posts']['publish']['~pf']['meta']
    >().toEqualTypeOf<Record<never, never>>();
  });
});

/** A procedure's `where` schema, through the `$ref` a recursive schema gets. */
function whereOf(key: string): unknown {
  const input = inputOf(key);
  const where = at(input, ['properties', 'where']);
  const target = at(where, ['$ref']);
  if (typeof target !== 'string') return where;
  return at(input, target.replace('#/', '').split('/'));
}

describe('a maskable field in a query', () => {
  it('says, in where, that a caller who may not read it is refused', () => {
    for (const key of ['deals/find', 'deals/count']) {
      const where = whereOf(key);
      expect(at(where, ['properties', 'amount', 'description'])).toBe(
        'Refused (VALIDATION) when the caller may not read amount.',
      );
      expect(at(where, ['properties', 'note', 'description'])).toBe(
        'Refused (VALIDATION) when the caller may not read note.',
      );
      expect(at(where, ['properties', 'title', 'description'])).toBeUndefined();
    }
  });

  it('says so in sort, for the fields that can be sorted', () => {
    // note is optional, so it cannot be sorted by anyone.
    expect(
      at(inputOf('deals/find'), ['properties', 'sort', 'description']),
    ).toBe(
      'Field names, "-" first for descending. Sorting on amount is refused (VALIDATION) when the caller may not read it.',
    );
    expect(
      at(inputOf('tasks/find'), ['properties', 'sort', 'description']),
    ).toBeUndefined();
  });
});
