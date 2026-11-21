import { type Logger, NoopLogger } from '@hexok/logger';
import { Adapter } from 'hexok';
import { z } from 'zod';
import { familyContext } from '../access.js';
import { Access, family } from '../index.js';

export const AppUseCase = family({
  actor: z.object({ userId: z.string(), roles: z.array(z.string()) }),
  actorId: (actor) => actor.userId,
});

export const actor = { userId: 'u1', roles: [] };

/** Access that allows every call, for tests that are not about access. */
export class AllowAll extends Adapter(Access) {
  override async check(): Promise<boolean> {
    return true;
  }
}

/**
 * A call context with a valid actor, and access that allows everything. A
 * procedure call replaces `access` with the app's own.
 */
export function callContext(logger: Logger = new NoopLogger()) {
  return familyContext(new AllowAll(), { actor, logger }, AppUseCase);
}

/** Access functions that allow every generated operation. */
export const allowAll = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};
