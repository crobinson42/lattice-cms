import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Companies = collection('companies', {
  schema: z.object({
    name: z.string().min(1),
    domain: z.string().optional(),
    industry: z.string().optional(),
    phone: z.string().optional(),
  }),
  // Each organization sees and changes only its own rows.
  tenant: 'organizationId',
});
