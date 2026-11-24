import { family } from '@latticecms/core';
import { z } from 'zod';

/** A member acting in one organization. */
export const AppUseCase = family({
  actor: z.object({ userId: z.string(), organizationId: z.string() }),
  actorId: (actor) => actor.userId,
  tenantOf: (actor) => actor.organizationId,
});
