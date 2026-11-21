import { MemoryLogger } from '@hexok/logger';
import { createLocalClient } from '@ts-pf/server';
import { FetchHandler } from '@ts-pf/server-http';
import type { UseCase } from 'hexok';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  type CallContext,
  collection,
  family,
  framework,
  MemoryStore,
  tenancy,
} from './index.js';

const Notes = collection('notes', {
  schema: z.object({ title: z.string() }),
  tenant: 'organizationId',
});

const member = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

/** Not strict: `support` on a member's object is a key the schema strips. */
const loose = z.union([
  member,
  z.object({ userId: z.string().min(1), support: z.literal(true) }),
]);

/** Lowercases the user id, so a caller's spelling never reaches Lattice. */
const lowercased = member.transform((actor) => ({
  ...actor,
  userId: actor.userId.toLowerCase(),
}));

/** What each hook saw of the actor, in order. */
type Seen = {
  tenantOf: unknown[];
  actorId: unknown[];
  access: unknown[];
  execute: unknown[];
};

/** A family whose hooks record the actor they receive. */
function recording<A extends typeof loose | typeof lowercased>(
  schema: A,
  seen: Seen,
) {
  return family({
    actor: schema,
    actorId: (actor) => {
      seen.actorId.push(actor);
      return actor.userId;
    },
    tenantOf: (actor) => {
      seen.tenantOf.push(actor);
      return 'support' in actor ? tenancy.bypass : actor.organizationId;
    },
  });
}

/**
 * The app over `schema`: notes in two organizations, and a `whoami` method
 * whose execute records `ctx.actor`. `call` makes one call on each path:
 * an HTTP request, the local client, and `build().context()`.
 */
async function app<A extends typeof loose | typeof lowercased>(schema: A) {
  const seen: Seen = { tenantOf: [], actorId: [], access: [], execute: [] };
  const Family = recording(schema, seen);
  class WhoAmI extends Family('notes.whoami', {
    collection: Notes,
    input: z.object({}),
    output: z.object({ userId: z.string() }),
  }) {
    async execute(
      ctx: UseCase.Ctx<typeof Family>,
      _input: Record<string, never>,
    ): Promise<{ userId: string }> {
      seen.execute.push(ctx.actor);
      return { userId: ctx.actor.userId };
    }
  }
  const record = (actor: unknown) => {
    seen.access.push(actor);
    return true;
  };
  const published: unknown[] = [];
  const built = framework({ family: Family })
    .collection(Notes, {
      access: {
        read: ({ actor }) => record(actor),
        create: ({ actor }) => record(actor),
        update: () => true,
        delete: () => true,
        whoami: ({ actor }) => record(actor),
      },
      methods: { whoami: WhoAmI },
    })
    .build({
      store: new MemoryStore(),
      events: {
        async publish(event: { readonly payload: unknown }) {
          published.push(event.payload);
        },
      },
      methods: () => ({ notes: { whoami: new WhoAmI() } }),
    });
  for (const organizationId of ['o1', 'o2']) {
    await built.repos.notes.insert(
      { title: organizationId },
      tenancy.scope(Notes, organizationId),
    );
  }
  const http = new FetchHandler(built.app);

  /** One call of `procedure` with `input`, on `path`, as `context`. */
  async function call(
    path: 'rpc' | 'local' | 'direct',
    procedure: 'find' | 'create' | 'whoami',
    input: Record<string, unknown>,
    context: CallContext<z.output<A>>,
  ): Promise<unknown> {
    if (path === 'rpc') {
      const result = await http.handle(
        new Request(`http://localhost/rpc/notes/${procedure}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ input }),
        }),
        { prefix: '/rpc', context: () => context },
      );
      if (!result.matched) throw new Error('no route');
      const body: unknown = await result.response.json();
      return body;
    }
    if (path === 'local') {
      const local = createLocalClient(built.app, { context });
      return procedure === 'find'
        ? local.notes.find(input)
        : procedure === 'whoami'
          ? local.notes.whoami({})
          : local.notes.create({ title: 't' });
    }
    const ctx = built.context(context);
    return procedure === 'find'
      ? built.useCases.notes.find.execute(ctx, input)
      : procedure === 'whoami'
        ? built.useCases.notes.whoami.execute(ctx, {})
        : built.useCases.notes.create.execute(ctx, { title: 't' });
  }
  return { seen, published, call };
}

const paths: readonly ('rpc' | 'local' | 'direct')[] = [
  'rpc',
  'local',
  'direct',
];

/** The error code a call failed with, however the path reported it. */
function codeOf(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return undefined;
  if ('code' in result) return result.code;
  return 'error' in result &&
    typeof result.error === 'object' &&
    result.error !== null &&
    'code' in result.error
    ? result.error.code
    : undefined;
}

/** Whether a failed call's error or body carries any data. */
function dataOf(result: unknown): unknown {
  if (typeof result !== 'object' || result === null) return undefined;
  if ('data' in result) return result.data;
  return 'error' in result &&
    typeof result.error === 'object' &&
    result.error !== null &&
    'data' in result.error
    ? result.error.data
    : undefined;
}

/** The titles in a find's output, however the path wrapped it. */
function titles(result: unknown): unknown[] {
  const page =
    typeof result === 'object' && result !== null && 'output' in result
      ? result.output
      : result;
  if (typeof page !== 'object' || page === null || !('docs' in page)) {
    throw new Error(`not a page: ${JSON.stringify(result)}`);
  }
  const { docs } = page;
  if (!Array.isArray(docs)) throw new Error('no docs');
  return docs.map((doc: unknown) =>
    typeof doc === 'object' && doc !== null && 'title' in doc
      ? doc.title
      : undefined,
  );
}

describe.each(paths)('the parsed actor, through %s', (path) => {
  it('a member’s object with support on it, under a non-strict schema, is a member and never bypassed', async () => {
    const { seen, call } = await app(loose);
    const logger = new MemoryLogger();
    // Not a literal: the extra key reaches Lattice as an edge bug would send it.
    const sent = { userId: 'u1', organizationId: 'o1', support: true };

    const found = await call(path, 'find', {}, { actor: sent, logger });
    await call(path, 'whoami', {}, { actor: sent, logger });
    const found2 = await call(path, 'find', {}, { actor: sent, logger });

    expect(titles(found)).toEqual(['o1']);
    expect(titles(found2)).toEqual(['o1']);
    expect(
      logger.records.filter((record) => record.message === 'tenancy.bypass'),
    ).toEqual([]);
    for (const actor of [...seen.tenantOf, ...seen.access, ...seen.execute]) {
      expect(actor).toEqual({ userId: 'u1', organizationId: 'o1' });
    }
    expect(seen.execute).toHaveLength(1);
  });

  it('a transforming schema’s output reaches tenantOf, access, actorId, execute and the event', async () => {
    const { seen, published, call } = await app(lowercased);
    const logger = new MemoryLogger();
    const actor = { userId: 'ANN', organizationId: 'o1' };

    await call(path, 'whoami', {}, { actor, logger });
    await call(path, 'create', { title: 't' }, { actor, logger });

    const transformed = { userId: 'ann', organizationId: 'o1' };
    for (const each of [
      ...seen.tenantOf,
      ...seen.actorId,
      ...seen.access,
      ...seen.execute,
    ]) {
      expect(each).toEqual(transformed);
    }
    expect(seen.execute).toHaveLength(1);
    expect(published).toMatchObject([{ actorId: 'ann' }]);
    expect(
      logger.records.filter((record) => record.fields.outcome === 'ok'),
    ).toMatchObject([
      { fields: { actorId: 'ann' } },
      { fields: { actorId: 'ann' } },
    ]);
  });

  it('strips unknown keys before an access function sees the actor', async () => {
    const { seen, call } = await app(loose);
    const sent = { userId: 'u1', organizationId: 'o1', role: 'admin' };

    await call(path, 'find', {}, { actor: sent, logger: new MemoryLogger() });

    expect(seen.access).toEqual([{ userId: 'u1', organizationId: 'o1' }]);
  });

  it('refuses an invalid actor with one UNAUTHORIZED and one log line, as before', async () => {
    const { seen, call } = await app(loose);
    const logger = new MemoryLogger();
    const sent = { userId: '', organizationId: 'o1' };

    const result = await Promise.resolve(
      call(path, 'find', {}, { actor: sent, logger }),
    ).then(
      (value) => value,
      (error: unknown) => error,
    );

    expect(codeOf(result)).toBe('UNAUTHORIZED');
    // The issues describe the caller's credentials: never sent.
    expect(dataOf(result)).toBeUndefined();
    // The family guard's line, as before: no actor fields, no issues.
    expect(
      logger.records.map(({ level, message, fields }) => ({
        level,
        message,
        fields,
      })),
    ).toEqual([
      {
        level: 'info',
        message: 'notes.find',
        fields: {
          catalog: 'lattice',
          collection: 'notes',
          action: 'find',
          outcome: 'refused',
          code: 'UNAUTHORIZED',
        },
      },
    ]);
    expect([...seen.access, ...seen.tenantOf, ...seen.execute]).toEqual([]);
  });
});
