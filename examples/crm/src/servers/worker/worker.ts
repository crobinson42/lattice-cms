import { IntegrationPublisher } from '@hexok/integration-events';
import type { Logger } from '@hexok/logger';
import type { Queue, QueueMaxDeliveries } from '@hexok/queue';
import {
  type WebhookEndpoints,
  Webhooks,
  type WebhooksConfig,
} from '@hexok/webhooks';
import type { CollectionStore } from '@latticecms/core';
import { PublishDealClosed } from '../../app/event-handlers/deal-closed-integration.js';
import { SendDealClosedWebhook } from '../../app/event-handlers/deal-closed-webhook.js';
import { WebhookEvents } from '../../domain/events/webhook-events.js';
import { QueueDomainEventPublisher } from '../../infra/events/queue-domain-events.js';
import { CrmDeals } from '../../integration/deals.js';
import { createApp } from '../app.js';
import { subscribeHandler } from './subscribe.js';

/** A running worker, and how to stop it. */
export type RunningWorker = {
  /** The subscriptions, by topic and group. */
  readonly subscriptions: readonly {
    readonly topic: string;
    readonly group: string;
  }[];
  /**
   * Stops taking events, waits for the handlers already running, then
   * stops the webhook sender. The caller stops the queues and the store.
   */
  stop(): Promise<void>;
};

/**
 * Starts the worker over started ports: it consumes the domain events the
 * HTTP process publishes, sends webhooks on its own queue, and publishes the
 * crm's integration contract on the queue other products read. The worker is
 * system code: its handlers use repos with the event's tenant, never an
 * actor's access.
 */
export async function startWorker(deps: {
  readonly store: CollectionStore;
  readonly domainQueue: Queue;
  readonly webhooksQueue: Queue;
  /** The queue the company's products share for integration events. */
  readonly integrationQueue: Queue;
  readonly endpoints: WebhookEndpoints;
  readonly logger: Logger;
  /** How often a failing handler runs before the queue gives up. */
  readonly maxDeliveries?: QueueMaxDeliveries;
  readonly webhooks?: WebhooksConfig;
}): Promise<RunningWorker> {
  const { logger } = deps;
  // The repos only: the worker runs no procedure. A handler that publishes a
  // domain event of its own would publish it to the same queue.
  const { repos } = createApp({
    store: deps.store,
    events: new QueueDomainEventPublisher({ queue: deps.domainQueue }),
  });
  const webhooks = new Webhooks(
    {
      events: WebhookEvents,
      queue: deps.webhooksQueue,
      endpoints: deps.endpoints,
      logger: logger.child({ component: 'webhooks' }),
    },
    deps.webhooks,
  );
  await webhooks.start();

  const integration = new IntegrationPublisher(CrmDeals, {
    queue: deps.integrationQueue,
  });

  const handlers = [
    new SendDealClosedWebhook({ deals: repos.deals, webhooks, logger }),
    new PublishDealClosed({ deals: repos.deals, integration, logger }),
  ];
  const subscriptions: { topic: string; group: string }[] = [];
  for (const handler of handlers) {
    subscriptions.push(
      await subscribeHandler(deps.domainQueue, handler, {
        maxDeliveries: deps.maxDeliveries ?? 10,
        logger,
      }),
    );
  }
  logger.info('worker subscribed', { subscriptions });

  return {
    subscriptions,
    async stop() {
      // Unsubscribing waits for each handler in flight, so a closed deal's
      // webhook is published before the sender stops.
      for (const { topic, group } of subscriptions) {
        await deps.domainQueue.unsubscribe(topic, { consumerGroup: group });
      }
      await webhooks.stop();
    },
  };
}
