import { NoopLogger } from '@hexok/logger';
import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { createLocalClient } from '@ts-pf/server';
import type { UseCase } from 'hexok';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  collection,
  type Doc,
  family,
  framework,
  MemoryStore,
  ref,
  type UpdateInput,
  unscoped,
} from './index.js';

// An SDK for this file only: registered before, and removed after. The
// context manager carries the active span across awaits, as an app's SDK
// does.
const exporter = new InMemorySpanExporter();
beforeAll(() => {
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }),
  );
});
afterEach(() => exporter.reset());
afterAll(() => {
  trace.disable();
  context.disable();
});

/** The finished spans as a tree of names, children in start order. */
type Node = { readonly name: string; readonly children: Node[] };
function tree(): Node[] {
  const spans = exporter.getFinishedSpans();
  const ids = new Set(spans.map((span) => span.spanContext().spanId));
  const nodeOf = (span: ReadableSpan): Node => ({
    name: span.name,
    children: spans
      .filter(
        (child) =>
          child.parentSpanContext?.spanId === span.spanContext().spanId,
      )
      .sort((a, b) => compare(a.startTime, b.startTime))
      .map(nodeOf),
  });
  return spans
    .filter((span) => {
      const parent = span.parentSpanContext?.spanId;
      return parent === undefined || !ids.has(parent);
    })
    .map(nodeOf);
}

function compare(
  a: readonly [number, number],
  b: readonly [number, number],
): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** The finished span named `name`. */
/** Every value the spans recorded: names, attributes, and events' names and attributes. */
function recordedValues(spans: readonly ReadableSpan[]): unknown[] {
  return spans.flatMap((span) => [
    span.name,
    ...Object.values(span.attributes).flat(),
    ...span.events.flatMap((event) => [
      event.name,
      ...Object.values(event.attributes ?? {}).flat(),
    ]),
  ]);
}

/**
 * Whether a recorded value is `secret`, or a string that holds it. A numeric
 * secret has a fraction: a hex id or a UUID never holds a ".", so a random
 * id cannot match it.
 */
function reveals(values: readonly unknown[], secret: string | number): boolean {
  return values.some(
    (value) =>
      value === secret ||
      (typeof value === 'string' && value.includes(String(secret))),
  );
}

function span(name: string): ReadableSpan {
  const found = exporter.getFinishedSpans().find((each) => each.name === name);
  if (found === undefined) throw new Error(`no span ${name}`);
  return found;
}

const Family = family({
  actor: z.object({ userId: z.string().min(1), role: z.string() }),
  actorId: (actor) => actor.userId,
});
const Companies = collection('companies', {
  schema: z.object({ name: z.string() }),
});
const Deals = collection('deals', {
  schema: z.object({
    title: z.string(),
    amount: z.number(),
    companyId: ref('companies'),
  }),
  maskable: ['amount'],
});

/** A store whose reads fail, as one that is down. */
class DownStore extends MemoryStore {
  override async find(): Promise<never> {
    throw new Error('store down');
  }
}

async function setup(store = new MemoryStore()) {
  const published: unknown[] = [];
  const built = framework({ family: Family })
    .collection(Companies, {
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
        // A refusal before any use case runs.
        delete: () => false,
      },
    })
    .collection(Deals, {
      access: {
        read: () => true,
        create: () => true,
        update: () => true,
        delete: () => true,
      },
      fields: { amount: { read: ({ actor }) => actor.role === 'manager' } },
    })
    .build({
      store,
      events: {
        async publish(event: { readonly payload: unknown }) {
          published.push(event.payload);
        },
      },
    });
  const actor = { userId: 'u1', role: 'member' };
  const local = (validation = true) =>
    createLocalClient(built.app, {
      context: { actor, logger: new NoopLogger() },
      validation: { input: validation },
    });
  return { ...built, actor, local, published };
}

/** The error code of a call, or 'ok'. */
function codeOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => 'ok',
    (error: unknown) =>
      typeof error === 'object' && error !== null && 'code' in error
        ? error.code
        : error,
  );
}

describe('spans', () => {
  it('trace a find as a procedure span with its use case under it', async () => {
    const { local } = await setup();

    await local().deals.find({});

    expect(tree()).toEqual([
      {
        name: 'deals/find',
        children: [{ name: 'deals.find', children: [] }],
      },
    ]);
    expect(span('deals/find').attributes).toEqual({
      'rpc.system': 'ts-pf',
      'rpc.service': 'deals',
      'rpc.method': 'find',
      'lattice.outcome': 'ok',
    });
    expect(span('deals.find').attributes).toEqual({
      'lattice.use_case': 'deals.find',
      'lattice.collection': 'deals',
      'lattice.action': 'find',
      'lattice.actor_id': 'u1',
      'lattice.outcome': 'ok',
    });
  });

  it('trace a create that publishes an event, and a get with population', async () => {
    const { local, repos, published } = await setup();
    const acme = await repos.companies.insert({ name: 'Acme' }, unscoped);

    const deal = await local().deals.create({
      title: 'Big one',
      amount: 4242,
      companyId: acme.id,
    });
    await local().deals.get({ id: deal.id, populate: ['companyId'] });

    expect(published).toHaveLength(1);
    expect(tree()).toEqual([
      {
        name: 'deals/create',
        children: [{ name: 'deals.create', children: [] }],
      },
      { name: 'deals/get', children: [{ name: 'deals.get', children: [] }] },
    ]);
  });

  it('trace an override that calls the generated operation as one use case span', async () => {
    class RenameCompany extends Family('companies.update', {
      collection: Companies,
    }) {
      constructor(
        private readonly deps: {
          update: (
            ctx: UseCase.Ctx<typeof Family>,
            input: UpdateInput<typeof Companies>,
          ) => Promise<Doc<typeof Companies>>;
        },
      ) {
        super();
      }
      async execute(
        ctx: UseCase.Ctx<typeof Family>,
        input: UpdateInput<typeof Companies>,
      ): Promise<Doc<typeof Companies>> {
        return this.deps.update(ctx, input);
      }
    }
    const built = framework({ family: Family })
      .collection(Companies, {
        access: { read: () => true, update: () => true },
        overrides: { update: RenameCompany },
      })
      .build({
        store: new MemoryStore(),
        events: { async publish(_event: object) {} },
        overrides: ({ generated }) => ({
          companies: {
            update: new RenameCompany({ update: generated.companies.update }),
          },
        }),
      });
    const acme = await built.repos.companies.insert({ name: 'Acme' }, unscoped);

    await createLocalClient(built.app, {
      context: {
        actor: { userId: 'u1', role: 'member' },
        logger: new NoopLogger(),
      },
    }).companies.update({ id: acme.id, name: 'Acme Inc' });

    expect(tree()).toEqual([
      {
        name: 'companies/update',
        children: [{ name: 'companies.update', children: [] }],
      },
    ]);
  });

  it('record a refusal with its outcome and code, never as an error', async () => {
    const { local, repos } = await setup();
    const acme = await repos.companies.insert({ name: 'Acme' }, unscoped);

    // A guard refuses: no use case span, only the procedure's.
    expect(await codeOf(local().companies.delete({ id: acme.id }))).toBe(
      'FORBIDDEN',
    );
    // execute refuses: both spans carry it.
    expect(await codeOf(local().deals.get({ id: 'nope' }))).toBe('NOT_FOUND');

    expect(tree()).toEqual([
      { name: 'companies/delete', children: [] },
      { name: 'deals/get', children: [{ name: 'deals.get', children: [] }] },
    ]);
    for (const [name, code] of [
      ['companies/delete', 'FORBIDDEN'],
      ['deals/get', 'NOT_FOUND'],
      ['deals.get', 'NOT_FOUND'],
    ]) {
      expect(span(name ?? '').attributes).toMatchObject({
        'lattice.outcome': 'refused',
        'lattice.code': code,
      });
      expect(span(name ?? '').status.code).toBe(SpanStatusCode.UNSET);
      expect(span(name ?? '').events).toEqual([]);
    }
  });

  it('record ts-pf’s own input rejection on the procedure span alone', async () => {
    const { local } = await setup();

    // @ts-expect-error limit is a number
    expect(await codeOf(local().deals.find({ limit: 'many' }))).toBe(
      'VALIDATION',
    );

    expect(tree()).toEqual([{ name: 'deals/find', children: [] }]);
    expect(span('deals/find').attributes).toMatchObject({
      'lattice.outcome': 'refused',
      'lattice.code': 'VALIDATION',
    });
    expect(span('deals/find').status.code).toBe(SpanStatusCode.UNSET);
  });

  it('record an unexpected throw as an error with an exception event', async () => {
    const { local } = await setup(new DownStore());

    await codeOf(local().deals.find({}));

    for (const name of ['deals/find', 'deals.find']) {
      expect(span(name).status.code).toBe(SpanStatusCode.ERROR);
      expect(span(name).attributes).toMatchObject({
        'lattice.outcome': 'failed',
        'error.type': 'Error',
      });
      expect(span(name).events.map((event) => event.name)).toEqual([
        'exception',
      ]);
    }
  });

  it('nest a direct use case call under the caller’s span', async () => {
    const { useCases, context: contextOf, actor } = await setup();
    const job = trace.getTracer('test').startSpan('job');

    await context.with(trace.setSpan(context.active(), job), () =>
      useCases.deals.find.execute(
        contextOf({ actor, logger: new NoopLogger() }),
        {},
      ),
    );
    job.end();

    expect(tree()).toEqual([
      { name: 'job', children: [{ name: 'deals.find', children: [] }] },
    ]);
  });

  it('never carry an input value, a document or a masked value', async () => {
    const { local, repos } = await setup();
    const acme = await repos.companies.insert(
      { name: 'secret-company' },
      unscoped,
    );

    const deal = await local().deals.create({
      title: 'hunter2-title',
      amount: 4242.5,
      companyId: acme.id,
    });
    await local().deals.get({ id: deal.id, populate: ['companyId'] });
    await codeOf(local().deals.find({ where: { amount: { gt: 4242.5 } } }));
    await codeOf(
      local(false).deals.update({
        id: deal.id,
        // @ts-expect-error amount is a number
        amount: 'hunter2-amount',
      }),
    );

    const recorded = recordedValues(exporter.getFinishedSpans());
    for (const secret of [4242.5, 'hunter2', 'secret-company']) {
      expect(reveals(recorded, secret)).toBe(false);
    }
    expect(exporter.getFinishedSpans().length).toBeGreaterThan(0);
  });
});
