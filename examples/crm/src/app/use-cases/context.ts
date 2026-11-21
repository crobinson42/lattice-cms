import { family, tenancy } from '@latticecms/core';
import type { UseCase } from 'hexok';
import { z } from 'zod';

/** Who is calling. The edge builds it; real auth arrives in Phase 2. */
export const actorSchema = z.object({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
  /** Support staff read every organization's rows, and change none. */
  support: z.boolean().optional(),
});

export type Actor = z.output<typeof actorSchema>;

/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    actor.support === true ? tenancy.bypass : actor.organizationId,
});

export type AppCtx = UseCase.Ctx<typeof AppUseCase>;
