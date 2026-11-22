import { collection } from '@latticecms/core';
import { z } from 'zod';

/** What a member may do in an organization. A manager sees deal amounts. */
export const role = z.enum(['member', 'manager']);

export type Role = z.output<typeof role>;

/**
 * Which organizations a user may act in. Global, not tenanted: one user's
 * memberships span organizations. The edge checks the requested
 * organization against it on every request, before the actor exists.
 */
export const Memberships = collection('memberships', {
  schema: z.object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    role: role.default('member'),
  }),
  // The edge's lookup, and one membership per pair.
  indexes: [{ fields: { userId: 1, organizationId: 1 }, unique: true }],
});
