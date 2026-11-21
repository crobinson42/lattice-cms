import { collection } from '@latticecms/core';
import { z } from 'zod';

export const Contacts = collection('contacts', {
  schema: z.object({
    name: z.string().min(1),
    email: z.email(),
    // A plain id until ref() arrives in Phase 1.
    companyId: z.string(),
  }),
});
