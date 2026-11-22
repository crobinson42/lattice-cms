import { MemoryLogger } from '@hexok/logger';
import { MongoStore } from '@latticecms/store-mongo';
import { context, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { MongoClient } from 'mongodb';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  inject,
  it,
} from 'vitest';
import { openDevSession } from '../../infra/auth/dev-session.js';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { testSessions } from '../../test/sessions.js';
import { createApp } from '../app.js';
import { organizationHeader } from './handler.js';
import { type Running, start } from './server.js';

// An SDK for this file only, as an app registers one at startup.
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
afterAll(() => {
  trace.disable();
  context.disable();
});

/** The children of `parent`, by name, in start order. */
function childrenOf(parent: ReadableSpan): string[] {
  return exporter
    .getFinishedSpans()
    .filter(
      (span) => span.parentSpanContext?.spanId === parent.spanContext().spanId,
    )
    .sort(
      (a, b) =>
        a.startTime[0] - b.startTime[0] || a.startTime[1] - b.startTime[1],
    )
    .map((span) => span.name);
}

describe('tracing through the server, on MongoStore', () => {
  const url = inject('mongoUrl');
  const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
  let running: Running | undefined;

  afterEach(async () => {
    await running?.stop();
    const client = new MongoClient(url);
    await client.db(database).dropDatabase();
    await client.close();
  });

  it('a deals.find is a procedure span, with the use case and the store call under it', async () => {
    const sessions = testSessions();
    const store = new MongoStore({ url, database });
    running = await start({
      store,
      events: new MemoryDomainEventPublisher(),
      sessions,
      support: new Set(),
      logger: new MemoryLogger(),
      port: 0,
      hostname: '127.0.0.1',
    });
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const token = await openDevSession(
      { crm, sessions },
      { userId: 'ann', organizationId: 'org-a' },
    );
    exporter.reset();

    const response = await fetch(new URL('/rpc/deals/find', running.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [organizationHeader]: 'org-a',
      },
      body: JSON.stringify({ input: {} }),
    });
    expect(response.status).toBe(200);

    const procedure = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'deals/find');
    if (procedure === undefined) throw new Error('no procedure span');
    // The use case and its store call are siblings: hexok has no around
    // hook, so the use case span cannot be active while execute runs.
    expect(childrenOf(procedure)).toEqual(['deals.find', 'find deals']);
    expect(
      exporter.getFinishedSpans().find((span) => span.name === 'deals.find')
        ?.attributes,
    ).toMatchObject({
      'lattice.actor_id': 'ann',
      'lattice.tenant_id': 'org-a',
      'lattice.outcome': 'ok',
    });
  });
});
