import { MemoryLogger } from '@hexok/logger';
import { tenancy } from '@latticecms/core';
import { MongoStore } from '@latticecms/store-mongo';
import { context, SpanKind, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { MongoClient } from 'mongodb';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { Deals } from '../../domain/collections/deals.js';
import { DealClosedEvent } from '../../domain/events/deal-closed.js';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { QueueDomainEventPublisher } from '../../infra/events/queue-domain-events.js';
import { ConfigWebhookEndpoints } from '../../infra/webhooks/config-endpoints.js';
import { MemoryQueue } from '../../test/memory-queue.js';
import { createApp } from '../app.js';
import { startWorker } from './worker.js';

// An SDK for this file only, as the worker's process registers one.
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

describe('a handled event, traced, on MongoStore', () => {
  it('is one consumer job span, with the handler’s store calls under it', async () => {
    const url = inject('mongoUrl');
    const database = `crm_${crypto.randomUUID().replaceAll('-', '')}`;
    const store = new MongoStore({ url, database });
    await store.start();
    const domainQueue = new MemoryQueue();
    const webhooksQueue = new MemoryQueue();
    const worker = await startWorker({
      store,
      domainQueue,
      webhooksQueue,
      endpoints: new ConfigWebhookEndpoints([]),
      logger: new MemoryLogger(),
    });
    try {
      const { repos } = createApp({
        store,
        events: new MemoryDomainEventPublisher(),
      });
      const deal = await repos.deals.insert(
        { title: 'Big one', companyId: 'c1', amount: 4242 },
        tenancy.scope(Deals, 'org-a'),
      );
      exporter.reset();

      await new QueueDomainEventPublisher({ queue: domainQueue }).publish(
        new DealClosedEvent({
          dealId: deal.id,
          outcome: 'won',
          actorId: 'u1',
          tenantId: 'org-a',
        }),
      );
      await domainQueue.idle();

      const spans = exporter.getFinishedSpans();
      const job = spans.find((span) => span.name === 'process deal.closed');
      if (job === undefined) throw new Error('no job span');
      expect(job.kind).toBe(SpanKind.CONSUMER);
      expect(job.attributes).toMatchObject({
        'messaging.system': 'hexok.queue',
        'messaging.operation.type': 'process',
        'messaging.destination.name': 'deal.closed',
        'messaging.consumer.group.name': 'crm:deals.send-closed-webhook',
        'hexok.queue.deliveries': 1,
        'hexok.queue.outcome': 'ok',
      });
      expect(
        spans
          .filter(
            (span) =>
              span.parentSpanContext?.spanId === job.spanContext().spanId,
          )
          .map((span) => span.name),
      ).toEqual(['find deals']);
      expect(
        JSON.stringify(spans.map((span) => span.attributes)),
      ).not.toContain('4242');
    } finally {
      await worker.stop();
      await domainQueue.stop();
      await webhooksQueue.stop();
      await store.stop();
      const client = new MongoClient(url);
      await client.db(database).dropDatabase();
      await client.close();
    }
  });
});
