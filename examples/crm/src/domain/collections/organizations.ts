import { collection } from '@latticecms/core';
import { z } from 'zod';

/**
 * The organizations users act in. Global, not tenanted: it is the tenant
 * itself. Only trusted code writes it, such as the dev scripts; a member
 * reads its own, and support reads every one.
 */
export const Organizations = collection('organizations', {
  schema: z.object({
    name: z.string().min(1),
  }),
});
