import { type CatalogProcedure, catalog } from '@ts-pf/docs';
import type { UseCase } from 'hexok';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { z } from 'zod';
import { ArchivePost } from './fixtures/archive-post.js';
import { AppUseCase, allowAll } from './fixtures/context.js';
import { Posts } from './fixtures/posts.js';
import { PublishPost } from './fixtures/publish-post.js';
import { collection, family, framework, many, ref } from './index.js';

const Deals = collection('deals', {
  schema: z.object({
    title: z.string(),
    amount: z.number(),
    note: z.string().optional(),
  }),
  maskable: ['amount', 'note'],
});
const Tasks = collection('tasks', {
  schema: z.object({
    title: z.string(),
    dealId: ref('deals'),
    relatedIds: z.array(ref('deals')).max(10),
  }),
});
// A slug whose singular the default would get wrong.
const People = collection('people', {
  schema: z.object({ name: z.string() }),
  relations: { boards: many('posts', { through: 'person_boards' }) },
  label: { singular: 'person', plural: 'people' },
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
  .collection(People, { access: allowAll }).contract;

const procedures = catalog(contract, { prefix: '/rpc' }).procedures;

const query =
  'Filter with where, order with sort, and page with limit and after (the previous page’s next).';

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

describe('procedure meta', () => {
  it('carries a summary and an MCP effect per operation, from the label', () => {
    expect(
      Object.fromEntries(
        procedures.map((procedure) => [
          procedure.key,
          [at(procedure.meta, ['mcp', 'effect']), procedure.docs?.summary],
        ]),
      ),
    ).toEqual({
      'posts/find': ['read', `Find posts. ${query}`],
      'posts/count': ['read', 'Count posts. Filter with where.'],
      'posts/get': ['read', 'Get one post by id.'],
      'posts/create': ['write', 'Create one post.'],
      'posts/update': [
        'write',
        'Update one post by id. Send only the fields to change, and null to clear an optional one.',
      ],
      // An override keeps the generated node, and its meta.
      'posts/delete': ['destructive', 'Delete one post by id.'],
      // A method describes itself, with its statics.
      'posts/publish': ['write', 'Publish a post by its id.'],
      'deals/find': ['read', `Find deals. ${query}`],
      'deals/count': ['read', 'Count deals. Filter with where.'],
      'deals/get': ['read', 'Get one deal by id.'],
      'deals/create': ['write', 'Create one deal.'],
      'deals/update': [
        'write',
        'Update one deal by id. Send only the fields to change, and null to clear an optional one.',
      ],
      'deals/delete': ['destructive', 'Delete one deal by id.'],
      'tasks/find': [
        'read',
        `Find tasks. ${query} populate expands dealId, relatedIds into documents.`,
      ],
      'tasks/count': ['read', 'Count tasks. Filter with where.'],
      'tasks/get': [
        'read',
        'Get one task by id. populate expands dealId, relatedIds into documents.',
      ],
      'tasks/create': ['write', 'Create one task.'],
      'tasks/update': [
        'write',
        'Update one task by id. Send only the fields to change, and null to clear an optional one.',
      ],
      'tasks/delete': ['destructive', 'Delete one task by id.'],
      // A declared label, where the slug's would be wrong.
      'people/find': ['read', `Find people. ${query}`],
      'people/count': ['read', 'Count people. Filter with where.'],
      'people/get': [
        'read',
        'Get one person by id. populate expands boards into documents.',
      ],
      'people/create': ['write', 'Create one person.'],
      'people/update': [
        'write',
        'Update one person by id. Send only the fields to change, and null to clear an optional one.',
      ],
      'people/delete': ['destructive', 'Delete one person by id.'],
      'people/boards/list': [
        'read',
        `List the boards of one person, by its id. ${query} populate expands peopleId, postsId into documents.`,
      ],
      'people/boards/set': [
        'destructive',
        'Replace the boards of one person, by its id. Links not given are removed.',
      ],
    });
  });

  it('says, under lattice, which collection and operation each procedure is', () => {
    const label = (singular: string, plural: string) => ({ singular, plural });
    expect(
      Object.fromEntries(
        procedures
          .filter(
            ({ key }) => key.startsWith('posts/') || key.includes('/boards/'),
          )
          .map((procedure) => [procedure.key, at(procedure.meta, ['lattice'])]),
      ),
    ).toEqual({
      'posts/find': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'find',
      },
      'posts/count': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'count',
      },
      'posts/get': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'get',
      },
      'posts/create': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'create',
      },
      'posts/update': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'update',
      },
      // The override is the operation it replaces.
      'posts/delete': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'delete',
      },
      'posts/publish': {
        collection: 'posts',
        label: label('post', 'posts'),
        operation: 'method',
        method: 'publish',
      },
      'people/boards/list': {
        collection: 'people',
        label: label('person', 'people'),
        operation: 'list',
        relation: 'boards',
        target: 'posts',
      },
      'people/boards/set': {
        collection: 'people',
        label: label('person', 'people'),
        operation: 'set',
        relation: 'boards',
        target: 'posts',
      },
    });
  });

  it('states the effect in its types, so a toolkit filters as the server does', () => {
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
      (typeof contract)['people']['boards']['list']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'read'>();
    expectTypeOf<
      (typeof contract)['people']['boards']['set']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'destructive'>();
    expectTypeOf<
      (typeof contract)['posts']['publish']['~pf']['meta']['mcp']['effect']
    >().toEqualTypeOf<'write'>();
  });
});

describe('a label', () => {
  it('comes from the slug when the collection declares none', () => {
    const labelOfSlug = (slug: string) =>
      collection(slug, { schema: z.object({ name: z.string() }) }).label;
    expect(labelOfSlug('companies')).toEqual({
      singular: 'company',
      plural: 'companies',
    });
    expect(labelOfSlug('deal_stages')).toEqual({
      singular: 'deal stage',
      plural: 'deal stages',
    });
    expect(labelOfSlug('lineItems')).toEqual({
      singular: 'line item',
      plural: 'line items',
    });
    expect(labelOfSlug('addresses')).toEqual({
      singular: 'address',
      plural: 'addresses',
    });
    expect(labelOfSlug('boxes')).toEqual({ singular: 'box', plural: 'boxes' });
    expect(labelOfSlug('status')).toEqual({
      singular: 'status',
      plural: 'status',
    });
    // A join collection gets one too.
    expect(People.relations.boards.through.label).toEqual({
      singular: 'person board',
      plural: 'person boards',
    });
  });

  it('is the declared one when there is one', () => {
    expect(People.label).toEqual({ singular: 'person', plural: 'people' });
  });
});

describe('a method', () => {
  class Bare extends AppUseCase('posts.bare', {
    collection: Posts,
    input: z.object({}),
    output: z.object({}),
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof AppUseCase>,
      _input: Record<string, never>,
    ): Promise<Record<string, never>> {
      return {};
    }
  }

  class Blank extends AppUseCase('posts.blank', {
    collection: Posts,
    input: z.object({}),
    output: z.object({}),
    summary: '  ',
    effect: 'read',
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof AppUseCase>,
      _input: Record<string, never>,
    ): Promise<Record<string, never>> {
      return {};
    }
  }

  it('without a summary and an effect is a compile error, and throws', () => {
    expect(() =>
      framework({ family: AppUseCase }).collection(Posts, {
        access: { ...allowAll, bare: () => true },
        // @ts-expect-error method "bare" needs a summary and an effect
        methods: { bare: Bare },
      }),
    ).toThrow('method "posts.bare" needs a summary');
  });

  // What a JavaScript caller can pass: an effect MCP does not know.
  class Unknown extends AppUseCase('posts.unknown', {
    collection: Posts,
    input: z.object({}),
    output: z.object({}),
    summary: 'Do nothing.',
    // @ts-expect-error not an effect
    effect: 'sometimes',
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof AppUseCase>,
      _input: Record<string, never>,
    ): Promise<Record<string, never>> {
      return {};
    }
  }

  it('with a blank summary or an unknown effect throws', () => {
    expect(() =>
      framework({ family: AppUseCase }).collection(Posts, {
        access: { ...allowAll, blank: () => true },
        methods: { blank: Blank },
      }),
    ).toThrow(
      `Lattice: method "posts.blank" needs a summary and an effect: one sentence on what it does, and whether it is 'read', 'write' or 'destructive'`,
    );
    expect(() =>
      framework({ family: AppUseCase }).collection(Posts, {
        access: { ...allowAll, unknown: () => true },
        // @ts-expect-error method "unknown" needs a summary and an effect
        methods: { unknown: Unknown },
      }),
    ).toThrow('method "posts.unknown" needs a summary and an effect');
  });
});

describe('an override', () => {
  class DescribedArchive extends AppUseCase('posts.delete', {
    collection: Posts,
    summary: 'Archive a post.',
    effect: 'write',
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof AppUseCase>,
      _input: { id: string },
    ): Promise<z.output<typeof Posts.output>> {
      throw new Error('not called');
    }
  }

  class DescribedSet extends AppUseCase('people.boards.set', {
    collection: People,
    effect: 'destructive',
  }) {
    async execute(
      _ctx: UseCase.Ctx<typeof AppUseCase>,
      _input: z.output<typeof People.relations.boards.set.input>,
    ): Promise<z.output<typeof People.relations.boards.set.output>> {
      throw new Error('not called');
    }
  }

  it('with a summary or an effect is a compile error, and throws', () => {
    expect(() =>
      framework({ family: AppUseCase }).collection(Posts, {
        access: allowAll,
        // @ts-expect-error override "delete" keeps the generated summary and effect
        overrides: { delete: DescribedArchive },
      }),
    ).toThrow(
      'Lattice: override "posts.delete" keeps the generated summary and effect; remove its summary and effect statics',
    );
    expect(() =>
      framework({ family: AppUseCase }).collection(People, {
        access: allowAll,
        // @ts-expect-error override "boards.set" keeps the generated summary and effect
        overrides: { boards: { set: DescribedSet } },
      }),
    ).toThrow('override "people.boards.set" keeps the generated summary');
  });
});

/** The JSON Schema of a procedure's output. */
function outputOf(key: string): Record<string, unknown> {
  const { output } = procedureAt(key);
  if (output?.kind !== 'json') throw new Error(`${key} has no JSON output`);
  return output.jsonSchema;
}

describe('a ref', () => {
  it('names its target collection as x-lattice-ref, wherever it appears', () => {
    // A ref refuses an empty id, so its schema says minLength 1.
    const ref = { type: 'string', minLength: 1, 'x-lattice-ref': 'deals' };
    expect(at(inputOf('tasks/create'), ['properties', 'dealId'])).toEqual(ref);
    expect(
      at(inputOf('tasks/create'), ['properties', 'relatedIds', 'items']),
    ).toEqual(ref);
    expect(at(outputOf('tasks/update'), ['properties', 'dealId'])).toEqual(ref);
    // A populating read: the id branch of what population may return.
    expect(
      at(outputOf('tasks/get'), ['properties', 'dealId', 'anyOf']),
    ).toContainEqual(ref);
    // A join collection's target id.
    expect(
      at(inputOf('people/boards/set'), [
        'properties',
        'links',
        'items',
        'properties',
        'postsId',
      ]),
    ).toEqual({ type: 'string', minLength: 1, 'x-lattice-ref': 'posts' });
  });
});

describe('the tenant field', () => {
  it('says so in the output, as x-lattice-tenant', () => {
    const Tenanted = family({
      actor: z.object({ userId: z.string(), orgId: z.string() }),
      actorId: (actor) => actor.userId,
      tenantOf: (actor) => actor.orgId,
    });
    const Notes = collection('notes', {
      schema: z.object({ text: z.string() }),
      tenant: 'orgId',
    });
    const tenanted = catalog(
      framework({ family: Tenanted }).collection(Notes, { access: allowAll })
        .contract,
    ).procedures;
    const schemaOf = (key: string, side: 'input' | 'output') => {
      const schema = tenanted.find((procedure) => procedure.key === key)?.[
        side
      ];
      return schema?.kind === 'json' ? schema.jsonSchema : {};
    };
    const output = schemaOf('notes/get', 'output');
    expect(at(output, ['properties', 'orgId'])).toEqual({
      type: 'string',
      'x-lattice-tenant': true,
    });
    expect(
      at(output, ['properties', 'text', 'x-lattice-tenant']),
    ).toBeUndefined();
    // Create never takes it: Lattice stamps it.
    const input = schemaOf('notes/create', 'input');
    expect(at(input, ['properties', 'orgId'])).toBeUndefined();
  });
});

describe('a maskable field', () => {
  it('says so in the output, as x-lattice-maskable', () => {
    const output = outputOf('deals/get');
    expect(at(output, ['properties', 'amount', 'x-lattice-maskable'])).toBe(
      true,
    );
    expect(at(output, ['properties', 'amount', 'description'])).toBe(
      'Withheld when the caller may not read it.',
    );
    expect(
      at(output, ['properties', 'title', 'x-lattice-maskable']),
    ).toBeUndefined();
  });

  it('keeps the meta the app gave it', () => {
    const Priced = collection('priced', {
      schema: z.object({ price: z.number().meta({ title: 'Price' }) }),
      maskable: ['price'],
    });
    const priced = framework({ family: AppUseCase }).collection(Priced, {
      access: allowAll,
      fields: { price: { read: () => true } },
    }).contract;
    const get = catalog(priced).procedures.find(
      ({ key }) => key === 'priced/get',
    );
    const output =
      get?.output?.kind === 'json' ? get.output.jsonSchema : undefined;
    expect(at(output, ['properties', 'price', 'title'])).toBe('Price');
    expect(at(output, ['properties', 'price', 'x-lattice-maskable'])).toBe(
      true,
    );
  });
});

describe('sort', () => {
  it('lists every key it accepts, ascending and descending', () => {
    // note is optional: it sorts, with missing values last (0037).
    expect(at(inputOf('deals/find'), ['properties', 'sort', 'items'])).toEqual({
      type: 'string',
      enum: [
        'title',
        '-title',
        'amount',
        '-amount',
        'note',
        '-note',
        'id',
        '-id',
        'createdAt',
        '-createdAt',
        'updatedAt',
        '-updatedAt',
      ],
    });
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
    expect(
      at(inputOf('deals/find'), ['properties', 'sort', 'description']),
    ).toBe(
      'Field names, "-" first for descending. Sorting on amount, note is refused (VALIDATION) when the caller may not read it.',
    );
    expect(
      at(inputOf('tasks/find'), ['properties', 'sort', 'description']),
    ).toBeUndefined();
  });
});
