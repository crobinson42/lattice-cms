import { collection } from '@latticecms/core';
import { z } from 'zod';

export const dealStages = ['lead', 'proposal', 'won', 'lost'] as const;

export const Deals = collection('deals', {
  schema: z.object({
    title: z.string().min(1),
    companyId: z.string(),
    amount: z.number().nonnegative(),
    stage: z.enum(dealStages).default('lead'),
    // deals.delete archives: the row stays, with archived set.
    archived: z.boolean().default(false),
    closedAt: z.iso.datetime().optional(),
  }),
});
