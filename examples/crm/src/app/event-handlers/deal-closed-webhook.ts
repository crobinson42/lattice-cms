import type { Logger } from '@hexok/logger';
import type { Webhooks } from '@hexok/webhooks';
import { type Doc, type Repo, tenancy } from '@latticecms/core';
import { EventHandler, type EventInstance } from 'hexok';
import { Deals } from '../../domain/collections/deals.js';
import { DealClosedEvent } from '../../domain/events/deal-closed.js';
import {
  DealClosedWebhook,
  type WebhookEvents,
} from '../../domain/events/webhook-events.js';

/**
 * A closed deal as a customer endpoint receives it, field by field from the
 * deal: never the document itself, so a new internal field on Deals cannot
 * reach a customer.
 */
export function dealClosedWebhook(
  deal: Doc<typeof Deals>,
  outcome: 'won' | 'lost',
  closedAt: string,
): DealClosedWebhook['payload'] {
  return {
    dealId: deal.id,
    companyId: deal.companyId,
    title: deal.title,
    outcome,
    closedAt,
  };
}

/**
 * Sends `deal.closed` to the organization's webhook endpoints. System code:
 * it reads the deal inside the event's own organization (0024), never with
 * an actor's access, and a deal it cannot see there is not sent.
 */
export class SendDealClosedWebhook extends EventHandler(
  'deals.send-closed-webhook',
  DealClosedEvent,
) {
  constructor(
    private readonly deps: {
      readonly deals: Repo<typeof Deals>;
      readonly webhooks: Pick<
        Webhooks<EventInstance<typeof WebhookEvents>>,
        'publish'
      >;
      readonly logger: Logger;
    },
  ) {
    super();
  }

  async handle(event: DealClosedEvent): Promise<void> {
    const { dealId, outcome, tenantId } = event.payload;
    const deal = await this.deps.deals.get(
      dealId,
      tenancy.scope(Deals, tenantId),
    );
    if (deal === null || deal.closedAt === undefined) {
      this.deps.logger.warn('deal.closed webhook skipped', {
        dealId,
        tenantId,
        reason: deal === null ? 'not-found' : 'not-closed',
      });
      return;
    }
    await this.deps.webhooks.publish({
      organizationId: tenantId,
      // The same deal closing is one event: a redelivery sends the same
      // webhook-id, and the receiver dedupes on it.
      eventId: `deal.closed:${deal.id}`,
      event: new DealClosedWebhook(
        dealClosedWebhook(deal, outcome, deal.closedAt),
      ),
    });
  }
}
