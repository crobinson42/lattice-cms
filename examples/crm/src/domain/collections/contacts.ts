import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    // The messages are what a form shows at the field.
    name: z.string().min(1, 'Enter a name'),
    email: z.email('Enter an email address, like ana@example.com'),
    phone: z.string().optional(),
    // The contact's job title.
    title: z.string().optional(),
    // A company with contacts cannot be deleted: restrict, the default.
    // Like every ref, it refuses '': "Choose the company".
    companyId: ref('companies'),
  }),
  tenant: 'organizationId',
}).hooks({
  // One spelling per address, so a where on email finds it.
  beforeChange: ({ data }) => ({ ...data, email: data.email.toLowerCase() }),
});
