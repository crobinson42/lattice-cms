import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Companies = collection('companies', {
  schema: z.object({
    name: z.string().min(1),
  }),
  tenant: 'organizationId',
});
