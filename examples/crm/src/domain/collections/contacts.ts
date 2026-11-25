import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.email(),
    phone: z.string().optional(),
    // The contact's job title.
    title: z.string().optional(),
    // A company with contacts cannot be deleted: restrict, the default.
    companyId: ref('companies'),
  }),
  tenant: 'organizationId',
}).hooks({
  // One spelling per address, so a where on email finds it.
  beforeChange: ({ data }) => ({ ...data, email: data.email.toLowerCase() }),
});
