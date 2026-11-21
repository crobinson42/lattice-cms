import { Event } from 'hexok';
import { z } from 'zod';

/** A deal was won or lost. Published by deals.close, not by Lattice. */
export class DealClosedEvent extends Event(
  'deal.closed',
  z.object({
    dealId: z.string(),
    outcome: z.enum(['won', 'lost']),
    actorId: z.string(),
  }),
) {}
