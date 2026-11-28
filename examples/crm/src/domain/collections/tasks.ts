import { collection } from '@latticecms/core';
import { z } from 'zod';
import { hasParent, parentRefs, parentRequired } from '../parents.js';

/** What to do next, and for whom, on a company, a contact or a deal. */
export const Tasks = collection('tasks', {
  schema: z
    .object({
      title: z.string().min(1),
      dueDate: z.iso.date().optional(),
      done: z.boolean().default(false),
      // The user who should do it. A task may be unassigned.
      assigneeId: z.string().min(1).optional(),
      ...parentRefs,
    })
    .refine(hasParent, parentRequired),
  tenant: 'organizationId',
  // My open tasks by due date, soonest first. Undated ones sort last.
  indexes: [
    { fields: { organizationId: 1, assigneeId: 1, done: 1, dueDate: 1 } },
  ],
});
