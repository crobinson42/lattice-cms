import { collection, many } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
  }),
  tenant: 'organizationId',
  relations: {
    companies: many('companies', { through: 'contact_companies' }),
  },
});
