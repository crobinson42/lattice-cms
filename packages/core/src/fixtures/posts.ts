import { z } from 'zod';
import { collection } from '../index.js';

export const Posts = collection('posts', {
  schema: z.object({
    title: z.string().min(1),
    body: z.string(),
    status: z.enum(['draft', 'published']),
  }),
});
