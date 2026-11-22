import { context, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { MongoStore } from './index.js';
import { databases } from './test/databases.js';

const dbs = databases();
const exporter = new InMemorySpanExporter();

// An SDK for this file only, as in core's tracing tests.
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
afterAll(async () => {
  trace.disable();
  context.disable();
  await dbs.close();
});

let database: string;
let store: MongoStore;

beforeEach(async () => {
  database = dbs.fresh();
  store = new MongoStore({ url: dbs.url, database });
  await store.start();
  exporter.reset();
});

afterEach(async () => {
  await store.stop();
  await dbs.drop(database);
});

/** Each finished span's name and its parent's name, in end order. */
function edges(): [string, string | undefined][] {
  const spans = exporter.getFinishedSpans();
  const byId = new Map(spans.map((span) => [span.spanContext().spanId, span]));
  return spans.map((span) => {
    const parent = span.parentSpanContext?.spanId;
    return [
      span.name,
      parent === undefined ? undefined : byId.get(parent)?.name,
    ];
  });
}

function named(name: string): ReadableSpan {
  const found = exporter.getFinishedSpans().find((span) => span.name === name);
  if (found === undefined) throw new Error(`no span ${name}`);
  return found;
}

describe('MongoStore spans', () => {
  it('trace each call as a database client span, with no values', async () => {
    await store.insert('deals', { id: 'd1', title: 'hunter2', amount: 4242 });
    await store.get('deals', 'd1');
    await store.find({
      collection: 'deals',
      where: { amount: { gt: 4000 } },
      sort: ['-createdAt'],
      limit: 10,
    });
    await store.count('deals', { title: { eq: 'hunter2' } });
    await store.update('deals', 'd1', { amount: 4243 });
    await store.remove('deals', 'd1');

    expect(exporter.getFinishedSpans().map((span) => span.name)).toEqual([
      'insert deals',
      'find deals',
      'find deals',
      'aggregate deals',
      'findAndModify deals',
      'findAndModify deals',
    ]);
    expect(named('insert deals').kind).toBe(SpanKind.CLIENT);
    expect(named('insert deals').attributes).toEqual({
      'db.system.name': 'mongodb',
      'db.namespace': database,
      'db.operation.name': 'insert',
      'db.collection.name': 'deals',
    });
    const recorded = JSON.stringify(
      exporter
        .getFinishedSpans()
        .map(({ name, attributes, events }) => ({ name, attributes, events })),
    );
    for (const value of ['4242', '4243', 'hunter2', '4000']) {
      expect(recorded).not.toContain(value);
    }
  });

  it('nest a transaction’s calls under one transaction span', async () => {
    await store.transaction(async (inner) => {
      await inner.insert('deals', { id: 'd1', title: 't' });
      await inner.remove('deals', 'd1');
    });

    expect(edges()).toEqual([
      ['insert deals', 'transaction'],
      ['findAndModify deals', 'transaction'],
      ['transaction', undefined],
    ]);
    expect(named('transaction').attributes).toEqual({
      'db.system.name': 'mongodb',
      'db.namespace': database,
      'db.operation.name': 'transaction',
    });
  });

  it('record a failed call as an error with its type, and no exception event', async () => {
    await store.insert('deals', { id: 'd1', title: 'secret-title' });
    exporter.reset();

    await expect(
      store.insert('deals', { id: 'd1', title: 'secret-title' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });

    const failed = named('insert deals');
    expect(failed.status).toEqual({
      code: SpanStatusCode.ERROR,
      message: 'CONFLICT',
    });
    expect(failed.attributes['error.type']).toBe('CONFLICT');
    expect(failed.events).toEqual([]);
    expect(JSON.stringify(failed.attributes)).not.toContain('secret-title');
  });
});
