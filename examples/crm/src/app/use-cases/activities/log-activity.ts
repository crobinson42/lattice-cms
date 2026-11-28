import type { Doc, Repo } from '@latticecms/core';
import type { z } from 'zod';
import {
  Activities,
  activityFields,
} from '../../../domain/collections/activities.js';
import type { DomainEventPublisher } from '../../ports/events/domain-event-publisher.js';
import { type AppCtx, AppUseCase } from '../context.js';

/**
 * Logs an activity, with the caller as its author. A method, not the
 * generated create: the author comes from the actor, so the client never
 * sends it, and activities have no create access.
 */
export class LogActivity extends AppUseCase('activities.log', {
  collection: Activities,
  // No authorId: a client cannot name one, and one it sends is dropped.
  input: activityFields,
  output: Activities.clientOutput,
  summary:
    'Log a note, call, email or meeting on a company, contact or deal. The caller is its author.',
  effect: 'write',
}) {
  constructor(
    private readonly deps: {
      activities: Repo<typeof Activities>;
      events: DomainEventPublisher;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: z.output<typeof activityFields>,
  ): Promise<Doc<typeof Activities>> {
    const scope = await ctx.access.scope(Activities, 'log');
    // The actor's id last, so nothing in the input can replace it.
    const authorId = AppUseCase.actorId(ctx.actor);
    const activity = await this.deps.activities.insert(
      { ...input, authorId },
      scope,
    );
    // What the generated create publishes, so the catalog and the worker
    // see a logged activity like any created document.
    await this.deps.events.publish(
      new Activities.events.created({
        doc: activity,
        actorId: authorId,
        tenantId: activity.organizationId,
      }),
    );
    return activity;
  }
}
