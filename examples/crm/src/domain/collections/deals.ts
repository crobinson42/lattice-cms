import { collection, many, ref } from '@latticecms/core';
import { z } from 'zod';

export const dealStages = [
  'lead',
  'qualified',
  'proposal',
  'negotiation',
  'won',
  'lost',
] as const;

/** What a contact is to a deal. */
export const contactRole = z.enum(['decision_maker', 'champion', 'other']);

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
    // The user who works the deal. A deal may be unassigned.
    ownerId: z.string().min(1).optional(),
    expectedCloseDate: z.iso.date().optional(),
  }),
  tenant: 'organizationId',
  // The people on a deal, and what each is to it. A contact on a deal
  // cannot be deleted: restrict, the default.
  relations: {
    contacts: many('contacts', {
      through: 'deal_contacts',
      fields: z.object({ role: contactRole }),
    }),
  },
  // Only managers and support see amounts: the contract's fields rule.
  maskable: ['amount'],
  // The pipeline view: one organization's deals in a stage, newest first.
  indexes: [{ fields: { organizationId: 1, stage: 1, createdAt: -1 } }],
});
