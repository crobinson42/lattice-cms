import { collection } from '@latticecms/core';
import { z } from 'zod';

/**
 * Which organizations a user may act in. Global, not tenanted: one user's
 * memberships span organizations. The edge checks the requested
 * organization against it on every request, before the actor exists.
 */
export const Memberships = collection('memberships', {
  schema: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  }),
  // The edge's lookup, and one membership per pair.
  indexes: [{ fields: { userId: 1, organizationId: 1 }, unique: true }],
});
