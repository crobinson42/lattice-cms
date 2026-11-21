import { family, tenancy } from '@latticecms/core';
import type { UseCase } from 'hexok';
import { z } from 'zod';

/** A member acting in one organization, which the edge checked. */
const memberSchema = z.strictObject({
  userId: z.string().min(1),
  organizationId: z.string().min(1),
});

/**
 * Support staff: they read every organization's rows and change none. The
 * edge sets this from server config, never from the request, and a support
 * actor has no organization.
 */
const supportSchema = z.strictObject({
  userId: z.string().min(1),
  support: z.literal(true),
});

/**
 * Who is calling. The edge builds it from the session and the
 * organization header. Strict, so an actor with both an organization and
 * the support flag is invalid rather than read as either.
 */
export const actorSchema = z.union([memberSchema, supportSchema]);

export type Actor = z.output<typeof actorSchema>;

/** The app's one use case family. Generated and hand-written use cases share it. */
export const AppUseCase = family({
  actor: actorSchema,
  actorId: (actor) => actor.userId,
  tenantOf: (actor) =>
    'support' in actor ? tenancy.bypass : actor.organizationId,
});

export type AppCtx = UseCase.Ctx<typeof AppUseCase>;
