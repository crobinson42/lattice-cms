import { Contract, Message } from '@hexok/integration-events';
import { z } from 'zod';

/**
 * The crm's published contract: what the company's other products may
 * consume. It imports nothing from the crm, so it can be published or
 * copied as is. A change here is a contract change: an additive field keeps
 * the version, and a breaking one is a new version (below).
 */

/**
 * A deal was won or lost. Version 1. It carries `amount`: this is an
 * internal contract between the company's own products, not a customer
 * one. A customer's webhook (`deal.closed`) leaves the amount out.
 */
export class DealClosedV1 extends Message(
  'deal.closed',
  1,
  z.object({
    dealId: z.string(),
    organizationId: z.string(),
    companyId: z.string(),
    outcome: z.enum(['won', 'lost']),
    /** The deal's amount, in the organization's own units. */
    amount: z.number(),
    closedAt: z.iso.datetime(),
  }),
) {}

// A breaking change, such as an amount with a currency, is a new version:
// `class DealClosedV2 extends Message('deal.closed', 2, schema, { downgrade:
// { to: DealClosedV1, map } })`, listed after DealClosedV1 below. One
// publish of v2 then sends v2 and its v1 copy, until every consumer moves.

/** The crm's contract. Its one queue topic is `crm.deals`. */
export class CrmDeals extends Contract('crm', { deals: [DealClosedV1] }) {}
