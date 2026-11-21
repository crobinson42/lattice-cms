import { z } from 'zod';
import { family } from '../index.js';

export const AppUseCase = family({
  actor: z.object({ userId: z.string(), roles: z.array(z.string()) }),
});
