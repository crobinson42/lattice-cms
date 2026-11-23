import { createServer, type IncomingHttpHeaders } from 'node:http';
import { MemoryLogger } from '@hexok/logger';
import { generateSecret, verify } from '@hexok/webhooks';
import { type CollectionStore, MemoryStore, tenancy } from '@latticecms/core';
import type { AnyWhere, StoredDoc } from '@latticecms/core/store';
import { afterEach, describe, expect, it } from 'vitest';
import { dealClosedV1 } from '../../app/event-handlers/deal-closed-integration.js';
import { dealClosedWebhook } from '../../app/event-handlers/deal-closed-webhook.js';
import { Deals } from '../../domain/collections/deals.js';
import { DealClosedEvent } from '../../domain/events/deal-closed.js';
import { MemoryDomainEventPublisher } from '../../infra/events/memory-domain-events.js';
import { QueueDomainEventPublisher } from '../../infra/events/queue-domain-events.js';
import { ConfigWebhookEndpoints } from '../../infra/webhooks/config-endpoints.js';
import { httpSetup, rpcRequest } from '../../test/http.js';
import { MemoryQueue } from '../../test/memory-queue.js';
import { backends, storeOf } from '../../test/stores.js';
import { createApp } from '../app.js';
import { startWorker } from './worker.js';

/** What a fake endpoint received. */
type Received = {
  readonly headers: IncomingHttpHeaders;
  readonly body: string;
};

/** Work to undo after each test, newest first. */
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/**
 * A customer endpoint on this machine. It answers each request with the
 * next of `statuses`, then 200.
 */
async function endpoint(statuses: number[] = []) {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => {
      body += chunk.toString();
    });
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.statusCode = statuses.shift() ?? 200;
      response.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () => new Promise<void>((resolve) => server.close(() => resolve())),
  );
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('no port');
  }
  return { url: `http://127.0.0.1:${address.port}/hook`, received };
}

/** Waits for `ready`, or fails after two seconds. */
async function until(ready: () => boolean): Promise<void> {
  for (let waited = 0; !ready(); waited += 10) {
    if (waited > 2000) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** The one value of a header. */
function header(headers: IncomingHttpHeaders, name: string): string {
  const value = headers[name];
  if (typeof value !== 'string') throw new Error(`no ${name}`);
  return value;
}

/**
 * A worker over `store`, its three memory queues, and org-a's one endpoint
 * for `deal.closed`. The webhook sender retries fast, for tests.
 */
async function worker(
  store: CollectionStore,
  options: {
    readonly statuses?: number[];
    readonly maxDeliveries?: number;
  } = {},
) {
  const target = await endpoint(options.statuses);
  const secret = generateSecret();
  const domainQueue = new MemoryQueue();
  const webhooksQueue = new MemoryQueue();
  const integrationQueue = new MemoryQueue();
  const logger = new MemoryLogger();
  const running = await startWorker({
    store,
    domainQueue,
    webhooksQueue,
    integrationQueue,
    endpoints: new ConfigWebhookEndpoints([
      {
        organizationId: 'org-a',
        id: 'ep1',
        url: target.url,
        secrets: [secret],
        events: ['deal.closed'],
      },
    ]),
    logger,
    maxDeliveries: options.maxDeliveries ?? 3,
    webhooks: {
      httpsOnly: false,
      allowPrivate: true,
      retrySchedule: [20],
      maxAttempts: 3,
      retryJitter: 0,
    },
  });
  let stopped = false;
  cleanups.push(async () => {
    if (!stopped) await running.stop();
    await domainQueue.stop();
    await webhooksQueue.stop();
    await integrationQueue.stop();
  });
  return {
    ...target,
    secret,
    domainQueue,
    webhooksQueue,
    integrationQueue,
    logger,
    async stop() {
      stopped = true;
      await running.stop();
    },
  };
}

/** Publishes `DealClosed` as deals.close does, to the worker's queue. */
function publishClosed(
  queue: MemoryQueue,
  payload: { readonly dealId: string; readonly tenantId: string },
) {
  return new QueueDomainEventPublisher({ queue }).publish(
    new DealClosedEvent({ ...payload, outcome: 'won', actorId: 'u1' }),
  );
}

/** A closed deal of `organizationId`, written as trusted code does. */
async function closedDeal(store: CollectionStore, organizationId: string) {
  const { repos } = createApp({
    store,
    events: new MemoryDomainEventPublisher(),
  });
  const scope = tenancy.scope(Deals, organizationId);
  const deal = await repos.deals.insert(
    { title: 'Big one', companyId: 'c1', amount: 4242 },
    scope,
  );
  await repos.deals.update(
    deal.id,
    { stage: 'won', closedAt: '2026-11-22T00:00:00.000Z' },
    scope,
  );
  return deal;
}

describe.each(backends)('the worker on $name', (backend) => {
  const store = storeOf(backend);

  it('sends a deal closed over HTTP to the organization’s endpoint, signed, with only its public fields', async () => {
    const w = await worker(store());
    const http = httpSetup(store(), {
      events: new QueueDomainEventPublisher({ queue: w.domainQueue }),
    });
    await http.member('ann', 'org-a');
    const token = await http.signIn('ann');
    const deal = await http.repos.deals.insert(
      { title: 'Big one', companyId: 'c1', amount: 4242 },
      tenancy.scope(Deals, 'org-a'),
    );

    const response = await http.fetch(
      rpcRequest(
        'deals/close',
        { id: deal.id, outcome: 'won' },
        { token, org: 'org-a' },
      ),
    );
    expect(response.status).toBe(200);
    await until(() => w.received.length === 1);

    const [request] = w.received;
    if (request === undefined) throw new Error('no request');
    const body: unknown = JSON.parse(request.body);
    expect(body).toEqual({
      type: 'deal.closed',
      timestamp: expect.any(String),
      data: {
        dealId: deal.id,
        companyId: 'c1',
        title: 'Big one',
        outcome: 'won',
        closedAt: expect.any(String),
      },
    });
    // The amount is a manager's field: it never leaves for a customer.
    expect(request.body).not.toContain('4242');
    expect(
      verify({
        secrets: [w.secret],
        id: header(request.headers, 'webhook-id'),
        timestamp: header(request.headers, 'webhook-timestamp'),
        signature: header(request.headers, 'webhook-signature'),
        body: request.body,
      }),
    ).toBe(true);
    // The domain event on the queue carries its organization.
    expect(
      w.domainQueue.published.find((entry) => entry.topic === 'deal.closed'),
    ).toEqual({
      topic: 'deal.closed',
      payload: {
        dealId: deal.id,
        outcome: 'won',
        actorId: 'ann',
        tenantId: 'org-a',
      },
    });
  });

  it('publishes deal.closed v1 on crm.deals, mapped from the deal, in a CloudEvents envelope', async () => {
    const w = await worker(store());
    const deal = await closedDeal(store(), 'org-a');

    await publishClosed(w.domainQueue, { dealId: deal.id, tenantId: 'org-a' });
    await w.domainQueue.idle();

    expect(w.integrationQueue.published).toEqual([
      {
        topic: 'crm.deals',
        payload: {
          specversion: '1.0',
          id: `deal.closed:${deal.id}`,
          source: 'crm',
          type: 'deal.closed',
          version: 1,
          time: expect.any(String),
          subject: deal.id,
          // An internal contract: unlike the webhook, it carries the amount.
          data: {
            dealId: deal.id,
            organizationId: 'org-a',
            companyId: 'c1',
            outcome: 'won',
            amount: 4242,
            closedAt: '2026-11-22T00:00:00.000Z',
          },
        },
      },
    ]);
  });

  it('retries an endpoint that fails, with the same webhook-id', async () => {
    const w = await worker(store(), { statuses: [500] });
    const deal = await closedDeal(store(), 'org-a');

    await publishClosed(w.domainQueue, { dealId: deal.id, tenantId: 'org-a' });
    await until(() => w.received.length === 2);

    const [first, second] = w.received;
    if (first === undefined || second === undefined) throw new Error('no');
    expect(header(second.headers, 'webhook-id')).toBe(
      header(first.headers, 'webhook-id'),
    );
  });

  it('reads only inside the event’s organization: org-a’s event cannot reach org-b’s deal', async () => {
    const w = await worker(store());
    const theirs = await closedDeal(store(), 'org-b');

    // An event that names org-b's deal under org-a.
    await publishClosed(w.domainQueue, {
      dealId: theirs.id,
      tenantId: 'org-a',
    });
    await w.domainQueue.idle();
    await w.webhooksQueue.idle();

    expect(w.webhooksQueue.published).toEqual([]);
    expect(w.received).toEqual([]);
    expect(w.integrationQueue.published).toEqual([]);
    for (const message of [
      'deal.closed webhook skipped',
      'deal.closed integration skipped',
    ]) {
      expect(
        w.logger.records.find((record) => record.message === message)?.fields,
      ).toMatchObject({
        dealId: theirs.id,
        tenantId: 'org-a',
        reason: 'not-found',
      });
    }
  });
});

describe('the integration payload', () => {
  it('takes only its own fields from a deal, whatever else the deal holds', async () => {
    const deal = await closedDeal(new MemoryStore(), 'org-a');
    const widened = Object.assign({}, deal, { internalNote: 'secret' });

    const payload = dealClosedV1(
      widened,
      'org-a',
      'won',
      '2026-11-22T00:00:00.000Z',
    );

    expect(Object.keys(payload).sort()).toEqual([
      'amount',
      'closedAt',
      'companyId',
      'dealId',
      'organizationId',
      'outcome',
    ]);
  });
});

describe('the webhook payload', () => {
  it('takes only its own fields from a deal, whatever else the deal holds', async () => {
    const deal = await closedDeal(new MemoryStore(), 'org-a');
    // A field Deals might gain one day, such as an internal note.
    const widened = Object.assign({}, deal, { internalNote: 'secret' });

    const payload = dealClosedWebhook(
      widened,
      'won',
      '2026-11-22T00:00:00.000Z',
    );

    expect(Object.keys(payload).sort()).toEqual([
      'closedAt',
      'companyId',
      'dealId',
      'outcome',
      'title',
    ]);
  });
});

/** A store whose reads fail, counting each attempt. */
class DownStore extends MemoryStore {
  gets = 0;
  override async get(): Promise<never> {
    this.gets += 1;
    throw new Error('store down');
  }
}

/** A store whose reads wait for `release`, to hold a handler in flight. */
class HeldStore extends MemoryStore {
  entered = false;
  #release: () => void = () => {};
  readonly #held = new Promise<void>((resolve) => {
    this.#release = resolve;
  });

  release(): void {
    this.#release();
  }

  override async get(
    collection: string,
    id: string,
    where?: AnyWhere,
  ): Promise<StoredDoc | null> {
    this.entered = true;
    await this.#held;
    return super.get(collection, id, where);
  }
}

describe('the worker’s delivery rules', () => {
  it('retries a failing handler, and gives up at maxDeliveries', async () => {
    const store = new DownStore();
    const w = await worker(store, { maxDeliveries: 3 });

    await publishClosed(w.domainQueue, { dealId: 'd1', tenantId: 'org-a' });
    await w.domainQueue.idle();

    // Each handler has its own group, so each retries on its own: 3 each.
    expect(store.gets).toBe(6);
    expect(
      [...w.domainQueue.gaveUp].sort((a, b) => a.group.localeCompare(b.group)),
    ).toEqual(
      ['crm:deals.publish-closed', 'crm:deals.send-closed-webhook'].map(
        (group) => ({
          topic: 'deal.closed',
          group,
          payload: expect.objectContaining({ dealId: 'd1' }),
        }),
      ),
    );
    expect(w.webhooksQueue.published).toEqual([]);
    expect(w.integrationQueue.published).toEqual([]);
  });

  it('stopping waits for the handlers in flight, which still send the webhook and the integration event', async () => {
    const store = new HeldStore();
    // Writing the deal never reads it, so it does not wait on the store.
    const held = await closedDeal(store, 'org-a');
    const w = await worker(store);

    await publishClosed(w.domainQueue, { dealId: held.id, tenantId: 'org-a' });
    await until(() => store.entered);
    let stopped = false;
    const stopping = w.stop().then(() => {
      stopped = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stopped).toBe(false);

    store.release();
    await stopping;

    expect(w.webhooksQueue.published).toEqual([
      expect.objectContaining({ topic: 'webhooks' }),
    ]);
    expect(w.integrationQueue.published).toEqual([
      expect.objectContaining({ topic: 'crm.deals' }),
    ]);
  });
});
