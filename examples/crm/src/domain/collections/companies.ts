import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Companies = collection('companies', {
  schema: z.object({
    // The message is what a form shows at the field.
    name: z.string().min(1, 'Enter a name'),
    domain: z.string().optional(),
    industry: z.string().optional(),
    phone: z.string().optional(),
  }),
  // Each organization sees and changes only its own rows.
  tenant: 'organizationId',
});
