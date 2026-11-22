import { Event } from 'hexok';
import { z } from 'zod';

/**
 * A deal was won or lost. Published by deals.close, not by Lattice. It
 * carries its organization, so a handler works inside it (0024).
 */
export class DealClosedEvent extends Event(
  'deal.closed',
  z.object({
    dealId: z.string(),
    outcome: z.enum(['won', 'lost']),
    actorId: z.string(),
    tenantId: z.string(),
  }),
) {}
