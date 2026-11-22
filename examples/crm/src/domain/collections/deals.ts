import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const dealStages = ['lead', 'proposal', 'won', 'lost'] as const;

export const Deals = collection('deals', {
  schema: z.object({
    title: z.string().min(1),
    // An archived deal still refers to its company, so it restricts too.
    companyId: ref('companies'),
    amount: z.number().nonnegative(),
    stage: z.enum(dealStages).default('lead'),
    // deals.delete archives: the row stays, with archived set.
    archived: z.boolean().default(false),
    closedAt: z.iso.datetime().optional(),
  }),
  tenant: 'organizationId',
  // Only managers and support see amounts: the contract's fields rule.
  maskable: ['amount'],
  // The pipeline view: one organization's deals in a stage, newest first.
  indexes: [{ fields: { organizationId: 1, stage: 1, createdAt: -1 } }],
});
