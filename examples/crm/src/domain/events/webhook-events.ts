import { Event, EventCatalog } from 'hexok';
import { z } from 'zod';

/**
 * What a customer's endpoint receives when a deal closes. Its own schema,
 * not the deal's: a new field on Deals never reaches a customer unless it is
 * added here. No amount: amounts are masked to managers inside the crm, and
 * an endpoint is not an actor whose role could be checked.
 */
export class DealClosedWebhook extends Event(
  'deal.closed',
  z.object({
    dealId: z.string(),
    companyId: z.string(),
    title: z.string(),
    outcome: z.enum(['won', 'lost']),
    closedAt: z.iso.datetime(),
  }),
) {}

/** The events the crm offers to customer endpoints. Apart from domain events. */
export class WebhookEvents extends EventCatalog('crm-webhooks', {
  dealClosed: DealClosedWebhook,
}) {}
