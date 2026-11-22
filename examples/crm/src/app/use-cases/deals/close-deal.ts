import { type Doc, LatticeError, type Repo } from '@latticecms/core';
import { z } from 'zod';
import { Deals } from '../../../domain/collections/deals.js';
import { DomainError } from '../../../domain/errors/domain.js';
import { DealClosedEvent } from '../../../domain/events/deal-closed.js';
import type { DomainEventPublisher } from '../../ports/events/domain-event-publisher.js';
import { type AppCtx, AppUseCase } from '../context.js';

/** Wins or loses a deal, once, and publishes DealClosed. */
export class CloseDeal extends AppUseCase('deals.close', {
  collection: Deals,
  input: z.object({ id: z.string(), outcome: z.enum(['won', 'lost']) }),
  // As a client receives a deal: the amount is withheld from a member.
  output: Deals.clientOutput,
}) {
  constructor(
    private readonly deps: {
      deals: Repo<typeof Deals>;
      events: DomainEventPublisher;
    },
  ) {
    super();
  }

  async execute(
    ctx: AppCtx,
    input: { id: string; outcome: 'won' | 'lost' },
  ): Promise<Doc<typeof Deals>> {
    const scope = await ctx.access.scope(Deals, 'close');
    const deal = await this.deps.deals.get(input.id, scope);
    if (deal === null) throw notFound(input.id);
    if (deal.closedAt !== undefined) {
      throw DomainError.AlreadyClosed({ id: input.id });
    }
    const closed = await this.deps.deals.update(
      input.id,
      { stage: input.outcome, closedAt: new Date().toISOString() },
      scope,
    );
    if (closed === null) throw notFound(input.id);
    await this.deps.events.publish(
      new DealClosedEvent({
        dealId: closed.id,
        outcome: input.outcome,
        actorId: AppUseCase.actorId(ctx.actor),
        // The deal's own tenant: a support actor cannot write, so it never
        // reaches this line.
        tenantId: closed.organizationId,
      }),
    );
    return closed;
  }
}

function notFound(id: string) {
  return LatticeError.NOT_FOUND({ collection: Deals.slug, id });
}
