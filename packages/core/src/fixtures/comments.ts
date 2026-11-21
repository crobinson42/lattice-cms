import { z } from 'zod';
import { collection } from '../index.js';

export const Comments = collection('comments', {
  schema: z.object({ postId: z.string(), text: z.string() }),
});
