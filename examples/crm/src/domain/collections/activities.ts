import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const activityKinds = ['note', 'call', 'email', 'meeting'] as const;

/**
 * What a client gives when it logs an activity: everything but the author,
 * which activities.log takes from the actor.
 */
export const activityFields = z.object({
  kind: z.enum(activityKinds),
  body: z.string().min(1),
  occurredAt: z.iso.datetime(),
  // A deleted company or contact takes its activities with it.
  companyId: ref('companies', { onDelete: 'cascade' }).optional(),
  contactId: ref('contacts', { onDelete: 'cascade' }).optional(),
  // Restrict, the default: deals.delete archives, so a deal is never
  // removed, and core refuses a cascade onto a collection that overrides
  // delete. An archived deal keeps its history.
  dealId: ref('deals').optional(),
});

/**
 * What happened, on a company, a contact or a deal: the timeline. Each
 * activity should have one of the three, but the schema does not say so: a
 * refined schema with refs fails when core builds its populated reads.
 */
export const Activities = collection('activities', {
  schema: activityFields.extend({
    // The user who logged it. Never the client's: see activities.log.
    authorId: z.string().min(1),
  }),
  tenant: 'organizationId',
  // A parent's timeline: one organization's activities on it, newest first.
  indexes: [
    { fields: { organizationId: 1, companyId: 1, occurredAt: -1 } },
    { fields: { organizationId: 1, contactId: 1, occurredAt: -1 } },
    { fields: { organizationId: 1, dealId: 1, occurredAt: -1 } },
  ],
});
