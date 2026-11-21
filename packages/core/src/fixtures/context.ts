import { type Logger, NoopLogger } from '@hexok/logger';
import { z } from 'zod';
import { family } from '../index.js';

export const AppUseCase = family({
  actor: z.object({ userId: z.string(), roles: z.array(z.string()) }),
  actorId: (actor) => actor.userId,
});

export const actor = { userId: 'u1', roles: [] };

/** A call context with a valid actor. */
export function callContext(logger: Logger = new NoopLogger()) {
  return { actor, logger };
}
