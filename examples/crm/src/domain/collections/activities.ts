import { collection } from '@latticecms/core';
import { z } from 'zod';
import { hasParent, parentRefs, parentRequired } from '../parents.js';

export const activityKinds = ['note', 'call', 'email', 'meeting'] as const;

/**
 * What a client gives when it logs an activity: everything but the author,
 * which activities.log takes from the actor.
 */
export const activityFields = z.object({
  kind: z.enum(activityKinds),
  body: z.string().min(1),
  occurredAt: z.iso.datetime(),
  ...parentRefs,
});

/** What happened, on a company, a contact or a deal: the timeline. */
export const Activities = collection('activities', {
  schema: activityFields
    .extend({
      // The user who logged it. Never the client's: see activities.log.
      authorId: z.string().min(1),
    })
    .refine(hasParent, parentRequired),
  tenant: 'organizationId',
  // A parent's timeline: one organization's activities on it, newest first.
  indexes: [
    { fields: { organizationId: 1, companyId: 1, occurredAt: -1 } },
    { fields: { organizationId: 1, contactId: 1, occurredAt: -1 } },
    { fields: { organizationId: 1, dealId: 1, occurredAt: -1 } },
  ],
});
