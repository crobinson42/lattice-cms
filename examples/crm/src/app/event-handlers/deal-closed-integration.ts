import type { IntegrationPublisher } from '@hexok/integration-events';
import type { Logger } from '@hexok/logger';
import { type Doc, type Repo, tenancy } from '@latticecms/core';
import { EventHandler } from 'hexok';
import { Deals } from '../../domain/collections/deals.js';
import { DealClosedEvent } from '../../domain/events/deal-closed.js';
import { type CrmDeals, DealClosedV1 } from '../../integration/deals.js';

/**
 * A closed deal as the crm's contract publishes it, field by field from the
 * deal: never the document, so a new internal field on Deals changes no
 * contract.
 */
export function dealClosedV1(
  deal: Doc<typeof Deals>,
  organizationId: string,
  outcome: 'won' | 'lost',
  closedAt: string,
): DealClosedV1['payload'] {
  return {
    dealId: deal.id,
    organizationId,
    companyId: deal.companyId,
    outcome,
    amount: deal.amount,
    closedAt,
  };
}

/**
 * Publishes `deal.closed` v1 to the company's other products, on
 * `crm.deals`. The domain event stays inside the crm (0010); this maps it at
 * the edge. System code: it reads the deal inside the event's own
 * organization, and a deal it cannot see there is not published.
 */
export class PublishDealClosed extends EventHandler(
  'deals.publish-closed',
  DealClosedEvent,
) {
  constructor(
    private readonly deps: {
      readonly deals: Repo<typeof Deals>;
      readonly integration: Pick<
        IntegrationPublisher<typeof CrmDeals>,
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
      this.deps.logger.warn('deal.closed integration skipped', {
        dealId,
        tenantId,
        reason: deal === null ? 'not-found' : 'not-closed',
      });
      return;
    }
    await this.deps.integration.publish(
      new DealClosedV1(dealClosedV1(deal, tenantId, outcome, deal.closedAt)),
      // A deal closes once: a redelivery publishes the same id, and a
      // consumer dedupes on it.
      { id: `deal.closed:${deal.id}`, subject: deal.id },
    );
  }
}
