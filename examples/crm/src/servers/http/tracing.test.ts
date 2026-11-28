import { MemoryLogger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
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
import { mcpClient } from '../../test/mcp.js';
import { testSessions } from '../../test/sessions.js';
import { builtPage } from '../../test/web.js';
import { type CrmApp, createApp } from '../app.js';
import { organizationHeader } from './headers.js';
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

/**
 * The names of `parent`'s children, sorted. Not by start time: the SDK
 * records it to the millisecond, so siblings often tie.
 */
function childrenOf(parent: ReadableSpan): string[] {
  return exporter
    .getFinishedSpans()
    .filter(
      (span) => span.parentSpanContext?.spanId === parent.spanContext().spanId,
    )
    .map((span) => span.name)
    .sort();
}

/** The id of the organization the dev script made with `name`. */
async function organizationNamed(
  crm: Pick<CrmApp, 'repos'>,
  name: string,
): Promise<string> {
  const [found] = (
    await crm.repos.organizations.find(
      { where: { name: { eq: name } }, limit: 1 },
      unscoped,
    )
  ).docs;
  if (found === undefined) throw new Error(`no organization ${name}`);
  return found.id;
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
      web: builtPage,
    });
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const token = await openDevSession(
      { crm, sessions },
      { userId: 'ann', name: 'Ann', organization: 'Org A' },
    );
    const org = await organizationNamed(crm, 'Org A');
    exporter.reset();

    const response = await fetch(new URL('/rpc/deals/find', running.url), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        [organizationHeader]: org,
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
      'lattice.tenant_id': org,
      'lattice.outcome': 'ok',
    });
  });

  it('an MCP tool call goes through the same router middleware, so it gets the same spans', async () => {
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
      web: builtPage,
    });
    const crm = createApp({ store, events: new MemoryDomainEventPublisher() });
    const token = await openDevSession(
      { crm, sessions },
      { userId: 'ann', name: 'Ann', organization: 'Org A' },
    );
    const client = await mcpClient(
      (request) => fetch(request),
      { token, org: await organizationNamed(crm, 'Org A') },
      new URL('/mcp', running.url).href,
    );
    exporter.reset();

    try {
      const result = await client.callTool({
        name: 'deals_find',
        arguments: {},
      });
      expect(result.isError).toBeUndefined();
    } finally {
      await client.close();
    }

    const procedure = exporter
      .getFinishedSpans()
      .find((span) => span.name === 'deals/find');
    if (procedure === undefined) throw new Error('no procedure span');
    expect(childrenOf(procedure)).toEqual(['deals.find', 'find deals']);
  });
});
