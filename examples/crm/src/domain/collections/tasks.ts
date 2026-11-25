import { collection, ref } from '@latticecms/core';
import { z } from 'zod';

/** What to do next, and for whom, on a company, a contact or a deal. */
export const Tasks = collection('tasks', {
  schema: z.object({
    title: z.string().min(1),
    dueDate: z.iso.date().optional(),
    done: z.boolean().default(false),
    // The user who should do it. A task may be unassigned.
    assigneeId: z.string().min(1).optional(),
    // The same parents and rules as an activity's.
    companyId: ref('companies', { onDelete: 'cascade' }).optional(),
    contactId: ref('contacts', { onDelete: 'cascade' }).optional(),
    dealId: ref('deals').optional(),
  }),
  tenant: 'organizationId',
  // My open tasks, overdue or due by a date: find filters on dueDate, and
  // cannot sort by it, since it is optional.
  indexes: [
    { fields: { organizationId: 1, assigneeId: 1, done: 1, dueDate: 1 } },
  ],
});
